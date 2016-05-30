/* Copyright (C) 2006-2016 Michel Gutierrez <mig@downloadhelper.net>
 * All Rights Reserved
 * 
 * If you are interested in methods used in this project, follow the
 * open source project at https://github.com/mi-g/fang
 */

const $chrome = require("chrome");
const Cc = $chrome.Cc;
const Ci = $chrome.Ci;
const Cu = $chrome.Cu;
const $osfile = Cu.import("resource://gre/modules/osfile.jsm", {});
const OS = $osfile.OS;
const self = require("sdk/self");
const path = require("sdk/fs/path");

const Class = require('sdk/core/heritage').Class;
const merge = require('sdk/util/object').merge;
const _ = require("sdk/l10n").get;
const simplePrefs = require("sdk/simple-prefs");

const tpsr = require("./tpsr");
const bits = require("./bits");
const mp4f = require("./mp4f");
const h264 = require("./h264");
const adts = require("./adts");

const chunkset = require('./chunkset');
const Chunkset = chunkset.Chunkset; 
const Codecs = chunkset.Codecs;

const BasePromiseWorker = Cu.import('resource://gre/modules/PromiseWorker.jsm', {}).BasePromiseWorker;
const mp2tWorkerPath = self.data.url()+"../lib/mp2t-worker.js";
const mp2tWorker = new BasePromiseWorker(mp2tWorkerPath);

exports.MP2TChunkset = Class({
	
	"extends": Chunkset,
	
	init: function(hash,hitData) {
		Chunkset.prototype.init.call(this, hash, hitData);
		this.codecs = Codecs;
		this.captureRaw = simplePrefs.prefs['mpegts.save-raw'];
		this.captureRawStreams = simplePrefs.prefs['mpegts.save-raw-streams'];
		this.endsOnSeenChunk = simplePrefs.prefs['mpegts.ends-on-seen-chunk'];
		this.pesTable = {};
		this.processQueue = [];
		this.workerWorking = false;
	},
	
	toUint8ArrayArray: function(data) {
		var parts = [];
		function Build(block) {
			if(Array.isArray(block))
				for(var i=0;i<block.length;i++)
					Build(block[i]);
			else if(block.byteLength>0)
				parts.push(new Uint8Array(block));
		}
		Build(data);
		return parts;
	},

	processChunkData: function(data,callback) {
		if(simplePrefs.prefs['hls.download-as-m2ts']) {
			return callback(null,data);
		}
		var self = this;
		function Process() {
			if(!self.workerWorking) {
				var handler = self.processQueue.shift();
				if(handler) {
					self.workerWorking = true;
					var transferables = ["keyFrames","dataSizes","sampleSizes","dataTimestamps","dataOffsets","stsc"];
					var chunkSetData = {
						processedChunksCount: self.processedChunksCount,
						codecs: self.codecs,
						pidTable: self.pidTable,
						pesTable: self.pesTable,
						pmtTable: self.pmtTable,
						dataOffset: self.dataOffset,
						nextTrackId: self.nextTrackId,
					}
					var transfers = [];
					self.walkThroughAvailPes(function(esi) {
						transferables.forEach(function(varName) {
							if(esi[varName]) {
								var buffer = esi[varName].data.buffer;
								esi[varName].data = buffer;
								transfers.push(buffer);
							}
						});
					});
					mp2tWorker.post('processData', [
   					    new BasePromiseWorker.Meta(chunkSetData, {transfers: transfers}),
					    new BasePromiseWorker.Meta(handler.data.buffer, {transfers: [handler.data.buffer]})
					 ])
					.then(function(workerResult) {
						Object.keys(chunkSetData).forEach(function(field) {
							self[field] = workerResult.meta[field];
						});
						self.walkThroughAvailPes(function(esi) {
							transferables.forEach(function(varName) {
								if(esi[varName])
									esi[varName].data = new Uint8Array(esi[varName].data); 
							});
						});
						if(workerResult.data)
							handler.callback(null,self.toUint8ArrayArray(workerResult.data));
						self.workerWorking = false;
						Process();							
					},function(err) {
						handler.callback(err);
						self.workerWorking = false;
						Process();						
					});
				}
			}
		}
		this.processQueue.push({
			data: data,
			callback: callback,
		});
		Process();
	},
	
	
	finalize: function(err,callback) {
		if(this.aborted)
			err = new Error("Aborted");
		
		var self = this;
		if(err) {
			Chunkset.prototype.finalize.call(this, err, callback);
		} else {
			if(simplePrefs.prefs['hls.download-as-m2ts']) {
				this.waitForWrittenData(function() {
					mp4f.finalize(self,null,self.downloadTarget,function(err) {
						Chunkset.prototype.finalize.call(self,err,callback);
					});
				});
			} else {
				var minTs = Infinity;
				var esis = [];
				this.walkThroughAvailPes(function(esi) {
					esis.push(esi);
					if(esi.tsMin<minTs)
						minTs = esi.tsMin;
				});
				if(esis.length==0) {
					Chunkset.prototype.finalize.call(this,new Error("MP2T - No data received"),callback);
					return;
				}
				esis.forEach(function(esi) {
					esi.shiftTs = esi.tsMin-minTs;
				});
				if(this.action && this.action.hit)
					this.action.hit.setOperation('finalizing...');
				this.waitForWrittenData(function() {
					mp4f.finalize(self,esis,self.downloadTarget,function(err) {
						Chunkset.prototype.finalize.call(self,err,callback);
					});
				});
			}
		}
	},
	
	getTrackDuration: function(esi) { // in milliseconds
		if(esi.durationSec)
			return Math.round(esi.durationSec*1000);
		if(esi.declaredSampleRate)
			return Math.round(esi.sampleCount*1000/(1024*esi.declaredSampleRate));
		else if(esi.sampleRate)
			return Math.round(esi.sampleCount*1000/esi.sampleRate);
		return Math.round((esi.tsMax - esi.tsMin));
	},

	getTotalDuration: function() { 
		var maxDuration = 0;
		this.walkThroughAvailPes(function(esi) {
			var duration = this.getTrackDuration(esi);
			if(duration>maxDuration)
				maxDuration = duration;
		});
		return maxDuration;
	},
	
	walkThroughAvailPes: function(callback) {
		for(var pid in this.pesTable) {
			var esi = this.pesTable[pid]; 
			if(esi.state=="started")
				callback.call(this,esi);
		}
	},
	
});
