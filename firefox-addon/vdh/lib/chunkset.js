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

const Class = require('sdk/core/heritage').Class;
const merge = require('sdk/util/object').merge;
const simplePrefs = require("sdk/simple-prefs");
const timers = require("sdk/timers")
const self = require("sdk/self");

const mp4f = require("./mp4f");
const hits = require("./hits");
const log = require("./log");
const utils = require("./utils");
const masked = require("./masked");

Cu.importGlobalProperties(["crypto"]);

exports.Codecs = {
	0x1b: {
		id: 0x1b,
		type: "video",
		name: "h264",
		strTag: "avc1",
		tag: 0x61766331,
		captureRaw: true,
	},
	0x0f: {
		id: 0x0f,
		type: "audio",
		name: "aac",
		strTag: "mp4a",
		tag: 0x6d703461,
		captureRaw: true,
	},
}

exports.Chunkset = Class({
	
	init: function(hitData) {
		var hash = utils.md5(hitData.url);
		this.id = "chunked:"+hash;
		this.chunks = [];	
		this.hash = hash;
		this.recording = false;
		this.lastDlingIndex = -1;
		this.lastDledIndex = -1;
		this.lastProcedIndex = -1;
		this.downloadingCount = 0;
		this.nextTrackId = 1;
		this.lastProgress = -1;
		this.processedChunksCount = 0;
		this.dataWritten = 0;
		this.currentDataBlockSize = -1;
		this.fileSize = 0;
		this.mdatOffsets = [];
		this.multiMdat = false;

		this.hit = merge({},hitData,{
			id: this.id,
			length: 0,
			url: hitData.url,
		});

	},
	
	updateHit: function(hitData) {
		this.hit.length = (this.hit.length || 0) + (hitData.length || 0);
		hits.newData(this.hit);
		this.chunks.push({
			url: hitData.url,
			index: this.chunks.length,
		});
	},
	
	handle: function() {
		if(!this.recording)
			return;
		while(this.downloadingCount<simplePrefs.prefs["chunks.concurrent-downloads"] && 
			this.lastDlingIndex+1<this.chunks.length && this.lastDledIndex-this.lastProcedIndex<simplePrefs.prefs["chunks.prefetch-count"]) {
			if(this.progressFn && this.lastProgress<0) {
				this.lastProgress = 0;
				this.progressFn(0);
			};
			this.downloadingCount++;
			this.downloadChunk.call(this,this.chunks[++this.lastDlingIndex],function(err,chunk) {
				this.downloadingCount--;
				if(err) {
					if(!this.recording) {
						return;
					}
					if(this.stopDownloadingOnChunkError) {
						this.noMoreChunkToDownload = true;
						if(chunk.index<this.chunks.length) {
							this.chunks.splice(chunk.index);
							if(chunk.index>0) {
								if(this.chunks[chunk.index-1]===null) {
									this.recording = false;
									this.finalize(null);
								}
							} else if(this.recording) {
								this.recording = false;
								this.finalize(new Error("No chunk received"));
							}
						}
						this.handle();
					} else {
						this.recording = false;
						this.lastDlingIndex = this.lastDledIndex;
						if(this.doNotReportDownloadChunkErrors && this.lastDledIndex>=0)
							this.finalize(null,function() {});
						else {
							console.warn("Error downloading chunk:",err.message || err);
							log.error(err);
							this.aborted = true;
							this.finalize(err,function() {});
						}
					}
				} else {
					chunk.downloading = false;
					chunk.downloaded = true;
					while(this.lastDledIndex+1<this.chunks.length && this.chunks[this.lastDledIndex+1].downloaded)
						this.lastDledIndex++;
				}
				if(this.aborted) {
					if(chunk.path) {
						OS.File.remove(chunk.path);
						delete chunk.path;
					}
					return;
				}
				this.handle();
			});
		}
		if(this.recording && this.lastProcedIndex<this.lastDledIndex && this.lastProcedIndex<this.chunks.length-1 && !this.chunks[this.lastProcedIndex+1].processing) {
			this.processChunk.call(this,this.chunks[this.lastProcedIndex+1],function(err,chunk) {
				if(err)
					console.warn("Error processing chunk: move to next chunk");
				chunk.processing = false;
				this.lastProcedIndex = chunk.index;
				if(chunk.path)
					OS.File.remove(chunk.path);
				this.handle();
				this.chunks[chunk.index] = null; // save memory
			});
		}

	},
	
	downloadChunk: function(chunk,callback) {
		if(chunk.downloaded)
			return callback.call(this,null,chunk);
		chunk.downloading = true;
		var self = this;

		function Download(callback) {
			utils.DownloadToByteArray(chunk.url,self.hit.headers || null,self.hit.isPrivate,!!self.masked,function(err,data) {
				if(!err)
					chunk.data = data;
				callback.call(self,err,chunk);
			});
		}

		chunk.downloadRetries = 0;
		function DownloadCallback(err,chunk) {
			if(err && chunk.downloadRetries++<=simplePrefs.prefs['download.retries']) {
				Download(DownloadCallback);
			} else {
				delete chunk.downloadRetries;
				callback.call(self,err,chunk);
			}
		}
		Download(DownloadCallback);
	},

	processChunkData: function(data,callback) {
		callback.call(this,null,data);
	},
	
	processChunk(chunk,callback) {
		var self = this;
		chunk.processing = true;
		function Process(data) {
			function ProcessCont() {
				self.processChunkData(data,function(err,data) {
					if(err) {
						callback.call(self,err,chunk);
					} else 
						self.appendDataToOutputFile(data,function(err) {
							if(!err)
								self.dataWritten += mp4f.length(data);
							self.processedSegmentsCount++;
							if(self.processedSegmentsCount>=self.segmentsCount) {
								self.outOfChunks();
							} else if(self.progressFn && !self.aborted) {
								var progress = Math.round(self.processedSegmentsCount*100/(self.segmentsCount || self.chunks.length || 1));
								if(progress!=self.lastProgress)
									self.progressFn(progress);
								self.lastProgress = progress;
							}						
							callback.call(self,err,chunk);
						});
				});							
			}
			if(self.endsOnSeenChunk) {
				crypto.subtle.digest({ name: "SHA-256" },data)
				.then(function(hash) {
					var hexCodes = [];
					var view = new DataView(hash);
					for (var i = 0; i < view.byteLength; i += 4) {
						var value = view.getUint32(i);
						var stringValue = value.toString(16);
						var padding = '00000000';
						var paddedValue = (padding + stringValue).slice(-padding.length);
						hexCodes.push(paddedValue);
					}
					var sign = hexCodes.join("");
					
					self.seenChunks = self.seenChunks || {};
					if(self.seenChunks[sign]) {
						self.recording = false;
						self.finalize(null);
						return;
					}
					self.seenChunks[sign] = true;
					ProcessCont();					
				});
			} else
				ProcessCont();
		}
		if(chunk.data)
			Process(chunk.data);
		else
			OS.File.read(chunk.path).then(function(data) {
				Process(data);
			},function(err) {
				callback.call(self,err,chunk);
			});
	},
	
	outOfChunks: function() {
		this.recording = false;
		this.finalize(null);
	},
	
	download: function(action,specs,successFn,errorFn,progressFn) {
		var self = this;
		this.aborted = false;
		this.action = action;
		this.downloadTarget = action.hit.data._downloadTarget;
		mp4f.writeFileHeader(this,function(err) {
			if(err)
				errorFn(err);
			else {
				self.recording = true;
				self.handle();
			}
		});
	},

	getNextTrackId: function() {
		return this.nextTrackId;
	},
	
	setNewId: function() {
		var index = 1;
		while(hits.getHit(this.id+"-"+index))
			index++;
		this.id = this.id+"-"+index;
		if(this.hit)
			this.hit.id = this.id;
	},

	finalize: function(err,callback) {
		this.cleanupChunkFiles();
		
		if(this.progressFn)
			this.progressFn(100);
		if(err && this.errorFn)
			this.errorFn();
		else if(!err && this.successFn)
			this.successFn();		

		if(!err) {
			var hit = hits.getHit(this.id);
			if(hit) {
				var hitData = hit.data;
				this.hit = hitData;
				delete hitData.url;
				hits.remove(this.id);
				this.setNewId();
				hitData.id = this.id;
				hits.newData(hitData);
			}
		}

		if(callback)
			callback(err);
	},
	
	appendDataToOutputFile: function(data,callback) {
		var self = this;
		var dataLength = mp4f.length(data);
		
		function AppendData() {
			self.currentDataBlockSize += dataLength;
			self.appendToOutputFile(data,function(err) {
				if(err)
					return callback(err);
				callback(null);
			});			
		}
		
		function AppendMdat() {
			self.mdatOffsets.push(self.lastDataIndex+8);
			var mdatBox = mp4f.mdatBox();
			self.appendToOutputFile(mdatBox,function(err,endFilePosition) {
				if(err)
					return callback(err);
				self.lastDataIndex = endFilePosition+dataLength;
				self.mdatLengthOffset = endFilePosition - 8;
				self.currentDataBlockSize = 0;
				AppendData();
			});	
		}
		
		if(simplePrefs.prefs['hls.download-as-m2ts']) {
			this.mdatOffsets.push(this.lastDataIndex);
			AppendData();
			this.lastDataIndex += dataLength;
		} else if(this.currentDataBlockSize<0) {
			AppendMdat();
		} else if(this.currentDataBlockSize+dataLength > 1000000000) {
			this.multiMdat = true;
			mp4f.updateMdatLength(this,this.mdatLengthOffset,this.currentDataBlockSize,function(err) {
				if(err)
					return callback(err);
				AppendMdat();
			});
		} else {
			this.mdatOffsets.push(this.lastDataIndex);
			AppendData();
			this.lastDataIndex += dataLength;
 
		}
	},

	appendToOutputFile: function(data,callback) {

		var self = this;
		
		if(this.aborted)
			return callback(null);
		
		function Append() {
			if(self.aborted) {
				while(self.pendingAppend.length>0) {
					var pending = self.pendingAppend.shift();
					pending.callback(null);
				}
				return;
			}
			if(self.appendFileTimer)
				timers.clearTimeout(self.appendFileTimer);
			self.appendFileTimer = timers.setTimeout(function() {
				self.file.close();
				self.file = null;
			},5000);
			var writingData = 0;
			while(self.pendingAppend.length>0) {
				var pending = self.pendingAppend.shift();
				writingData++;
				(function(pending) {
					mp4f.writeMulti(self.file,pending.data,function(err) {
						var length = mp4f.length(data);
						self.fileSize += length;
						pending.callback(err,self.fileSize);
						writingData--;
						if(writingData==0 && self.waitingDataWritten)
							while(self.waitingDataWritten.length) {
								(self.waitingDataWritten.shift())();
							}
					});
				})(pending);
			}			
		}
		this.pendingAppend = this.pendingAppend || [];
		this.pendingAppend.push({
			data: data,
			callback: callback,
		});
		if(this.file) {
			Append(data,callback);
		} else {
			if(!this.openingAppendFile) {
				this.openingAppendFile = true;
				var fileProvider = OS;
				var fileOptions = {
						write:true,
						append:true,
				}
				if(self.masked) {
					fileProvider = masked;
					fileOptions.iv = self.biniv;
					fileOptions.key = self.cryptoKey;
				}
				fileProvider.File.open(self.downloadTarget+".part",fileOptions)
					.then(function(file) {
						self.openingAppendFile = false;
						self.file = file;
						Append();
					},function(error) {
						self.openingAppendFile = false;
						while(self.pendingAppend.length>0) {
							var pending = self.pendingAppend.shift();
							pending.callback(error);
						}
					});
			}
		}
	},
	
	waitForWrittenData: function(callback) {
		if(this.aborted)
			callback();
		else if(this.pendingAppend && this.pendingAppend.length) {
			this.waitingDataWritten = this.waitingDataWritten || [];
			this.waitingDataWritten.push(callback);
		} else
			callback();
	},
	
	cleanupChunkFiles: function() {
		for(var i=Math.max(0,this.lastProcedIndex);i<Math.max(0,this.lastDledIndex);i++) {
			var chunk = this.chunks[i];
			if(chunk && chunk.path) {
				OS.File.remove(chunk.path);
				chunk = null;
			}
		}
	},
	
	actionAbortFn: function(filePath) {
		var hit = this.action.hit;
		this.recording = false;
		this.aborted = true;
		OS.File.remove(filePath);
		this.action.hit.setOperation(null);
		this.action.cleanup();
		this.action.hit.setCurrentAction(null);
		this.action.notifyRunning(false);
		this.action = null;
		this.finalize(new Error("Chunk download aborted"),function() {});
	},

});
