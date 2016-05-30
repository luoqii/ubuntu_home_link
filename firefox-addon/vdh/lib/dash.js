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
const _ = require("sdk/l10n").get;

const chunkset = require("./chunkset");
const Chunkset = chunkset.Chunkset;

const bits = require("./bits");
const mp4f = require("./mp4f");
const utils = require("./utils");

exports.DashChunkset = Class({

	"extends": Chunkset,

	init: function(hitData) {
		Chunkset.prototype.init.call(this, hitData);
		hitData.descrPrefix = _("dash-streaming");
		this.endsWhenNoMoreSegment = true;
	},

	processChunkData: function(data,callback) {
		this.chunkIndex = (this.chunkIndex || 0) + 1;
		var chunkDataOffset = 0;
		var moof = mp4f.getTags("moof",data);
		if(moof.length<1)
			return callback(new Error("No moof in fragment"));
		var moofBaseOffset = moof[0].offset;
		var mfhd = mp4f.getTags("mfhd",moof[0].data);
		if(mfhd.length<1)
			return callback(new Error("No mfhd in fragment"));
		var seqNum = bits.ReadInt32(mfhd[0].data,4);
		if(this.seqNum && seqNum<=this.seqNum)
			return callback(new Error("Invalid sequence number in mfhd"));
		this.seqNum = seqNum;
		var dataOffset = 0;
		for(var id in this.esis)
			this.esis[id].sampleGroups = [];
		
		var trafs = mp4f.getTags("traf",moof[0].data);
		for(var ti=0,tl=trafs.length;ti<tl;ti++) {
			var traf = trafs[ti];
			var tfhd = mp4f.getTags("tfhd",traf.data);
			if(tfhd.length<1)
				return callback(new Error("No tfhd in track fragment"));
			var tfhdData = tfhd[0].data;
			
			var trackId = bits.ReadInt32(tfhdData,4);
			if(trackId>=this.nextTrackId)
				this.nextTrackId = trackId+1;
			var esi = this.esis[trackId] = this.esis[trackId] || {
				trackId: trackId,
				dataOffsets: [],
				dataSizes: [],
				keyFrames: [],
				sampleGroups: [],
				sampleCount: 0,
				chunkNumber: 0,
				sampleSizes: [],
				duration: 0,
			};
			if(this.mpd.codecs) {
				var codecs=this.mpd.codecs.split(",");
				if(trackId<=codecs.length) {
					for(var codecId in chunkset.Codecs) {
						var codec = chunkset.Codecs[codecId];
						if(codecs[trackId-1].indexOf(codec.strTag)==0) {
							esi.codecId = codecId;
							esi.codec = codec;
							esi.streamType = codec.type;
						}
					}
				}
			}
			
			var flags = bits.ReadInt24(tfhdData,1);
			var bdoPresent = (flags & 0x1) >>>0;
			var sdiPresent = ((flags & 0x2) >>> 1) >>>0;
			var dsdPresent = ((flags & 0x8) >>> 3) >>>0;
			var dssPresent = ((flags & 0x10) >>> 4) >>>0;
			var dsfPresent = ((flags & 0x20) >>> 5) >>>0;
			esi.durationIsEmpty = ((flags & 0x10000) >>> 16) >>>0;
			var dbMoof = ((flags & 0x20000) >>> 17) >>>0;
			
			var tfhdOffset = 8;
			
			if(bdoPresent) {
				dataOffset = bits.ReadInt64(tfhdData,tfhdOffset) - this.globalOffset;
				tfhdOffset += 8;	
			} else if(dbMoof || dataOffset==0)
				dataOffset = moofBaseOffset;
			if(sdiPresent) {
				esi.sampleDescriptionIndex = bits.ReadInt32(tfhdData,tfhdOffset);
				tfhdOffset += 4;
			}
			if(dsdPresent) {
				esi.defaultSampleDuration = bits.ReadInt32(tfhdData,tfhdOffset);
				tfhdOffset += 4;
			}
			if(dssPresent) {
				esi.defaultSampleSize = bits.ReadInt32(tfhdData,tfhdOffset);
				tfhdOffset += 4;
			}
			if(dsfPresent) {
				esi.defaultSampleFlags = bits.ReadInt32(tfhdData,tfhdOffset);
				tfhdOffset += 4;
			}

			var truns = mp4f.getTags("trun",traf.data);
			for(var tri=0, trl=truns.length;tri<trl;tri++) {
				var trun = truns[tri];
				var group = {
					s: 0,
					o: 0,
					d: 0,
				}
				esi.sampleGroups.push(group);
				var trunData = trun.data;
				var flags = bits.ReadInt24(trunData,1);
				var doPresent = flags & 0x1;
				var fsfPresent = ((flags & 0x4) >>> 2) >>>0;
				var sdPresent = ((flags & 0x100) >>> 8) >>>0;
				var ssPresent = ((flags & 0x200) >>> 9) >>>0;
				var sfPresent = ((flags & 0x400) >>> 10) >>>0;
				var sctoPresent = ((flags & 0x800) >>> 11) >>>0;
				
				var sampleCount = bits.ReadInt32(trunData,4);
				var trunOffset = 8;
				if(doPresent) {
					var trunDataOffset =  bits.ReadInt32(trunData,trunOffset);
					trunOffset += 4;
					group.o = dataOffset+trunDataOffset;
				} else if(dataOffset==0)
					group.o = dataOffset;
					
				if(fsfPresent) {
					var trunFirstSampleFlags =  bits.ReadInt32(trunData,trunOffset);
					trunOffset += 4;					
				}
				for(var si=0;si<sampleCount;si++) {
					var sample = {};
					if(sdPresent) {
						sample.d =  bits.ReadInt32(trunData,trunOffset);
						trunOffset += 4;											
					} else
						sample.d = esi.defaultSampleDuration;
					if(ssPresent) {
						sample.s =  bits.ReadInt32(trunData,trunOffset);
						trunOffset += 4;
					} else
						sample.s = esi.defaultSampleSize;
					if(sfPresent) {
						sample.f =  bits.ReadInt32(trunData,trunOffset);
						trunOffset += 4;											
					} else
						sample.f = esi.defaultSampleFlags;
					if(sample.f & 0x02000000)
						esi.keyFrames.push(esi.sampleCount+si);
					if(sctoPresent) {
						sample.C =  bits.ReadInt32(trunData,trunOffset);
						trunOffset += 4;											
					} 
					group.s += sample.s;
					group.d += sample.d;
					esi.sampleSizes.push(sample.s);
					esi.duration += sample.s;

					esi.stts = esi.stts || [];
					if(esi.stts.length==0 || esi.stts[esi.stts.length-1].d!=sample.d)
						esi.stts.push({
							c: 1,
							d: sample.d,
						});
					else
						esi.stts[esi.stts.length-1].c++;
				}
				group.c = sampleCount;
				dataOffset = group.o + group.s;
				esi.sampleCount += sampleCount;

				esi.stsc = esi.stsc || [];
				if(esi.stsc.length==0 || esi.stsc[esi.stsc.length-1].samples_per_chunk!=sampleCount)
					esi.stsc.push({
						first_chunk: esi.chunkNumber,
						samples_per_chunk: sampleCount,
						sample_description_index: 0,
					});
				esi.chunkNumber++;
			}
		}
		
		this.globalOffset += data.length;

		var dataOut = [];
		for(var id in this.esis) {
			var esi = this.esis[id];
			for(var i=0;i<esi.sampleGroups.length;i++) {
				var group = esi.sampleGroups[i];
				dataOut.push(data.subarray(group.o,group.o+group.s));
				esi.dataOffsets.push({b:this.chunkIndex-1,o:chunkDataOffset});
				esi.dataSizes.push(group.s);
				this.dataOffset+=group.s;				
				chunkDataOffset+=group.s;
			}
		}
		callback.call(this,null,dataOut);

	},
	
	getTrackDuration: function(esi) {
		return this.getTotalDuration();
	},

	getTotalDuration: function() {
		return Math.round(this.mpd.duration*1000);
	},
	
	finalize: function(err,callback) {
		
		var esis = [];
		for(var id in this.esis) {
			var esi = this.esis[id];
			esis.push(esi);
		}
		var self = this;
		this.waitForWrittenData(function() {
			mp4f.finalize(self,esis,self.downloadTarget,function(err) {
				Chunkset.prototype.finalize.call(self,err,callback);
			});
		});
	},
	
	handleInitSegment: function(mpd) {
		this.mpd = mpd;
		this.init = {};
		this.segmentsCount = mpd.segments.length; 
		if(!mpd.init_segment)
			return;
		try {
			var data = utils.toByteArray(mpd.init_segment);
			this.globalOffset = data.length;
			var ftyp = mp4f.getTags("ftyp",data);
			this.init.ftyp = ftyp[0].data;
			var moov = mp4f.getTags("moov",data);
			this.init.stsd = {};
			this.init.tkhd = {};
			this.init.vmhd = {};
			this.init.smhd = {};
			this.init.edts = {};
			this.init.hdlr = {};
			this.init.mdhd = {};
			this.init.dinf = {};
			this.init.edts = {};
			this.timeScale = {};
			var mvhd = mp4f.getTags("mvhd",moov[0].data);
			this.init.mvhd = mvhd[0].data;
			this.init.timescale = bits.ReadInt32(mvhd[0].data,12);
			this.init.duration = bits.ReadInt32(mvhd[0].data,16);
			if(this.init.duration==0) {
				this.init.duration = Math.round(mpd.duration * this.init.timescale);
				bits.WriteInt32(mvhd[0].data,16,this.init.duration);
			}
			var iods = mp4f.getTags("iods",moov[0].data);
			if(iods.length>0)
				this.init.iods = iods[0].data;
			var traks = mp4f.getTags("trak",moov[0].data);
			for(var i=0;i<traks.length;i++) {
				var trak = traks[i];
				var tkhd = mp4f.getTags("tkhd",trak.data);
				var trackId = bits.ReadInt32(tkhd[0].data,12);
				
				var tkhdData = tkhd[0].data;
				this.init.tkhd[trackId] = tkhdData;
				var tkhdDuration = bits.ReadInt32(tkhdData,20);
				if(tkhdDuration==0) {
					tkhdDuration = this.init.duration;
					bits.WriteInt32(tkhdData,20,tkhdDuration);
				}
				
				var edts = mp4f.getTags("edts",trak.data);
				if(edts.length>0) {
					this.init.edts[trackId] = edts[0].data;
					var elst = mp4f.getTags("elst",edts[0].data);
					if(elst.length>0) {
						var mediaTime = bits.ReadInt32(elst[0].data,12);
						bits.WriteInt32(elst[0].data,8,this.init.duration-mediaTime);
					}
				}
				var mdia = mp4f.getTags("mdia",trak.data);
				var hdlr = mp4f.getTags("hdlr",mdia[0].data);
				this.init.hdlr[trackId] = hdlr[0].data;
				var dinf = mp4f.getTags("dinf",mdia[0].data);
				if(dinf.length>0)
					this.init.dinf[trackId] = dinf[0].data;				
				var minf = mp4f.getTags("minf",mdia[0].data);
				
				var mdhd = mp4f.getTags("mdhd",mdia[0].data);
				var mdhdData = mdhd[0].data
				this.init.mdhd[trackId] = mdhdData;
				var mdhdDuration = bits.ReadInt32(mdhdData,16);
				var mdhdTimescale = bits.ReadInt32(mdhdData,12);
				this.timeScale[trackId] = mdhdTimescale;
				if(mdhdDuration==0) {
					mdhdDuration = Math.round((this.init.duration * mdhdTimescale) / this.init.timescale);
					bits.WriteInt32(mdhdData,16,mdhdDuration);
				}
				
				var vmhd = mp4f.getTags("vmhd",minf[0].data);
				if(vmhd.length>0)
					this.init.vmhd[trackId] = vmhd[0].data;
				var smhd = mp4f.getTags("smhd",minf[0].data);
				if(smhd.length>0)
					this.init.smhd[trackId] = smhd[0].data;
				var stbl = mp4f.getTags("stbl",minf[0].data);
				var stsd = mp4f.getTags("stsd",stbl[0].data);
				this.init.stsd[trackId] = stsd[0].data;
			}
		} catch(e) {
			console.warn("Error decoding DASH init segment");
		}
	},
	
	download: function(action,specs,successFn,errorFn,progressFn) {
		var self = this;
		this.aborted = false;
		this.action = action;
		this.specs = specs;
		this.successFn = successFn;
		this.errorFn = errorFn;
		this.progressFn = progressFn;
		this.downloadTarget = action.hit.data._downloadTarget;
		this.dataOffset = 0;
		this.nextTrackId = 1;
		this.chunks = [];
		this.dataOffset = 0;
		this.globalOffset = 0;
		this.esis = {};
		this.seqNum = 0;
		this.processedSegmentsCount = 0;

		action.hit.updateActions();
				
		this.handleInitSegment(action.hit.data._mpd);
		
		Cu.import("resource://gre/modules/NetUtil.jsm");
		var url = NetUtil.newURI(action.hit.data.url).resolve(this.mpd.commonBaseUrl);
		url=NetUtil.newURI(url).resolve(this.mpd.base_url);
		this.mpd.segments.forEach(function(segment) {
			var fragmentUrl = NetUtil.newURI(url).resolve(segment.url);
			self.chunks.push({
				url: fragmentUrl,
				index: self.chunks.length,
			});
		});
		
		this.masked = !!action.masked;
		if(this.masked) {
			this.biniv = action.biniv;
			this.cryptoKey = action.cryptoKey;
		}

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
	
});
