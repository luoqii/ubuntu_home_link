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

const merge = require('sdk/util/object').merge;
const Class = require('sdk/core/heritage').Class;
const _ = require("sdk/l10n").get;
const timers = require("sdk/timers");
const simplePrefs = require("sdk/simple-prefs");

const hits = require("./hits");
const actions = require("./actions");
const utils = require("./utils");
const mp4f = require("./mp4f");
const mp2t = require("./mp2t");
const m3u8 = require("./m3u8");
const tpsr = require("./tpsr");

const chunkset = require("./chunkset");
const Chunkset = chunkset.Chunkset;
const Codecs = chunkset.Codecs;

var chunkSets = {};

var cleanupTimer = timers.setInterval(function() {
	var remaining = [];
	for(var id in chunkSets) {
		var hit = hits.getHit(id);
		if(!hit) {
			delete chunkSets[id];
		} else
			remaining.push(chunkSets[id].chunks.length);
	}
},60000);

function ChunkSetFromHitData(baseHitData,hash,mediaUrl,tags) {
	var id = "hls:"+hash;
	var hitData = merge({},baseHitData,{
		id: id,			
        "extension": simplePrefs.prefs['hls.download-as-m2ts'] ? "m2ts" : "mp4",
        hls: tags,
        url: mediaUrl,
        length: null,
        chunked: "hls",
        durationFloat: 0,
	},tpsr.hit(baseHitData,id));
	var xMedia = tags["EXT-X-MEDIA"];
	if(xMedia) {
		hitData.quality = xMedia["NAME"] || hitData.quality;  
	}
	var xStreamInf = tags["EXT-X-STREAM-INF"];
	if(xStreamInf) {
		hitData.size = xStreamInf["RESOLUTION"] || hitData.size;
		hitData.bitrate = parseInt(xStreamInf["BANDWIDTH"]) || hitData.bitrate;
	}
	hits.newData(hitData);
	
	var chunkSet = new HlsChunkSet();
	chunkSet.init(hitData);
	return chunkSet;
}

exports.handleMaster = function(manifest,baseHitData) {
	manifest.walkThrough(function(mediaUrl,tags) {
		var hash = utils.md5(mediaUrl);
		
		var id = "hls:"+hash;
		var chunkSet = chunkSets[id];
		if(!chunkSet) {
			chunkSet = ChunkSetFromHitData(baseHitData,hash,mediaUrl,tags);
			chunkSets[id] = chunkSet;
		}
	});
}

exports.handleMedia = function(manifest,baseHitData,manifestUrl) {
	var hash = utils.md5(manifestUrl);
	var chunkSet = chunkSets["hls:"+hash];
	if(!chunkSet) {
		chunkSet = ChunkSetFromHitData(baseHitData,hash,manifestUrl,{});
		chunkSets["hls:"+hash] = chunkSet;
	}
	var hit = hits.getHit("hls:"+hash);
	if(!hit)
		return;
	var chunksAddedCount = 0;
	chunkSet.chunkDuration = 1000;
	manifest.walkThrough(function(mediaUrl,tags) {
		var extInf = tags["EXTINF"];
		if(extInf) {
			var chunkDuration = Math.round(parseFloat(extInf)*1000);
			if(chunkDuration > chunkSet.chunkDuration)
				chunkSet.chunkDuration = chunkDuration;
		}
		var hashCode = utils.hashCode(mediaUrl);
		if(hashCode in chunkSet.chunksMap)
			return;
		chunksAddedCount++;
		chunkSet.chunksMap[hashCode] = 1;
		chunkSet.chunks.push({
			url: mediaUrl,
			index: chunkSet.chunks.length,
		});
		if(extInf) {
			hit.data.durationFloat += parseFloat(extInf);
			hit.data.duration = Math.round(hit.data.durationFloat);
			hit.update();
		}
	});
	if(chunksAddedCount>0) {
		chunkSet.segmentsCount += chunksAddedCount; 
		chunkSet.handle();
	}
}

exports.getChunkSet = function(hitData) {
	return chunkSets["hls:"+utils.md5(hitData.url)] || null;
}

var HlsChunkSet = Class({
	
	"extends": mp2t.MP2TChunkset,
	
	init: function(hitData) {
		mp2t.MP2TChunkset.prototype.init.call(this, hitData);
		var hash = utils.md5(hitData.url);
		this.id = "hls:"+hash;
		this.hit = merge({},hitData,{
			chunked: "hls",
			descrPrefix: _("hls-streaming"),			
		});
		this.chunksMap = {};
		this.chunks = [];
		this.segmentsCount = 0;
		this.doNotReportDownloadChunkErrors = true;
		hits.newData(this.hit);
	},

	download: function(action,specs,successFn,errorFn,progressFn) {
		var self = this;
		this.aborted = false;
		this.action = action;
		this.specs = specs;
		this.successFn = function() {
			tpsr.recordingFinished(true,self.hit);
			successFn.apply(self,arguments);
		};
		this.errorFn = function() {
			tpsr.recordingFinished(false,self.hit);
			errorFn.apply(self,arguments);
		};
		this.progressFn = progressFn;
		this.downloadTarget = action.hit.data._downloadTarget;
		this.nextTrackId = 1;
		this.processedSegmentsCount = 0;
		this.recording = true;
				
		this.masked = !!action.masked;
		if(this.masked) {
			this.biniv = action.biniv;
			this.cryptoKey = action.cryptoKey;
		}
		
		if(!this.segmentsCount)
			this.requestMediaManifest();
						
		if(simplePrefs.prefs['hls.download-as-m2ts']) {
			self.recording = true;
			self.handle();
		} else
			mp4f.writeFileHeader(this,function(err) {
				if(err)
					errorFn(err);
				else {
					self.recording = true;
					self.handle();
				}
			});
		
		action.hit.abortFn = function() {
			self.actionAbortFn(self.downloadTarget+".part");
		}

	},
	
	outOfChunks: function() {
		var self = this;
		var timeout = Math.max(self.chunkDuration,5000)*2;
		this.requestMediaManifest();
		timers.setTimeout(function() {
			self.requestMediaManifest();
		},timeout/2);
		if(this.endTimer)
			timers.clearTimeout(this.endTimer);
		(function(segmentsCount) {
			self.endTimer = timers.setTimeout(function() {
				if(self.recording && segmentsCount==self.segmentsCount) {
					mp2t.MP2TChunkset.prototype.outOfChunks.call(self);
				}								
			},timeout);								
		})(this.segmentsCount);
	},

	requestMediaManifest: function() {
		if(!this.hit)
			return;
		if(!this.recording)
			return;
		var self = this;
		utils.Request({
			url: self.hit.url,
			isPrivate: this.hit.isPrivate,
			headers: this.hit.headers || null,
			onComplete: function(response) {
				if(response.status==200 && self.hit.url) {
					var manifest = m3u8.get(response.text,self.hit.url);
					if(manifest && manifest.isMedia()) {
						exports.handleMedia(manifest,self.hit,self.hit.url);
						return;
					}
				}
			},
		}).get();			
	},
	
	endRecording: function() {
		if(this.recording) {
			this.recording = false;
			this.finalize(null,function(err) {});
		}		
	},
	
	finalize: function(err,callback) {
		mp2t.MP2TChunkset.prototype.finalize.call(this, err, callback);
		delete chunkSets[this.id];
	},
	
	mediaTimeoutTriggered: function() {
		this.endRecording();
	},
	
	setNewId: function() {
		var oldId = this.id;
		delete chunkSets[this.id];
		mp2t.MP2TChunkset.prototype.setNewId.call(this);
		chunkSets[this.id] = this;
		this.requestMediaManifest(); // try to get a new hit as soon as possible in case the video is still streaming
	},
	
});

var HlsStopRecordAction = merge(Class({
	
	"extends": actions.actionClasses['abort'],

	start: function() {
		var chunkSet = chunkSets[this.hit.data.id];
		if(!chunkSet)
			return;
		chunkSet.endRecording();
		this.hit.updateActions();
	},

}),{
	actionName: "hlsstoprecord",
	canPerform: function(hit) {
		if(hit.data.chunked!="hls")
			return false;
		var chunkSet = chunkSets[hit.data.id];
		if(!chunkSet)
			return false;
		return chunkSet.recording;
	},
	priority: 100,
	catPriority: 3,
	title: _("action.stoprecord.title"),
	description: _("action.stoprecord.description"),
	icon: "images/icon-action-stoprecord-64.png",
});

actions.registerAction("hlsstoprecord",HlsStopRecordAction);
