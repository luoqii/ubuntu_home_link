/* Copyright (C) 2006-2016 Michel Gutierrez <mig@downloadhelper.net>
 * All Rights Reserved
 * 
 * If you are interested in methods used in this project, follow the
 * open source project at https://github.com/mi-g/fang
 */

importScripts("resource://gre/modules/workers/require.js");
let PromiseWorker = require("resource://gre/modules/workers/PromiseWorker.js");

// TODO find a way not to code a static resource path 
const bits = require("resource://b9db16a4-6edc-47ec-a1f4-b86292ed211d/lib/bits.js");
const adts = require("resource://b9db16a4-6edc-47ec-a1f4-b86292ed211d/lib/adts.js");
const h264 = require("resource://b9db16a4-6edc-47ec-a1f4-b86292ed211d/lib/h264.js");

let worker = new PromiseWorker.AbstractWorker();
worker.dispatch = function(method, args = []) {
	return self[method](...args);
},
worker.postMessage = function(...args) {
	self.postMessage(...args);
};
worker.close = function() {
	self.close();
};
worker.log = function(...args) {
	//dump("Worker: " + args.join(" ") + "\n");
};
self.addEventListener("message", msg => worker.handleMessage(msg));

function MP2TChunksetWorker(meta) {
	this.init(meta);
}

MP2TChunksetWorker.prototype = {
	
	init: function(meta) {
		var self = this;
		Object.keys(meta).forEach(function(field) {
			self[field] = meta[field];
		});
	},
	
	processChunkData: function(data,callback) {

		this.perfBytes = 0;
		this.perfTime = 0;
		this.perfVideoSize = 0;
		
		this.dataOffset = 0;
		this.processedChunksCount++;

		this.pidTable = this.pidTable || {
			0: "processPAT",
		} 

		var dataOut = [];
		if(bits.ReadInt8(data,0)==0x47) {
			var packetIndex = 0;
			var packetSize = 0xbc; // 188
			var piTable = {	}
			while(packetIndex*packetSize<data.length) {
				
				var pi = {};
				
				var offset = packetIndex*packetSize;
				packetIndex++;
				var w1 = bits.ReadInt32(data,offset);
				pi.tei = ((w1 & 0x800000) >>> 23) >>> 0;
				pi.pusi = ((w1 & 0x400000) >>> 22) >>> 0;
				pi.tp = ((w1 & 0x200000) >>> 21) >>> 0;
				pi.pid = ((w1 & 0x1fff00) >>> 8) >>> 0;
				pi.sc = ((w1 & 0xc0) >>> 6) >>> 0;
				pi.aff = ((w1 & 0x20) >>> 5) >>> 0;
				pi.pf = ((w1 & 0x10) >>> 4) >>> 0;
				pi.cc = ((w1 & 0xf)) >>> 0;
				
				var p = 4;
				var ps = packetSize - 4;
				
				if(pi.aff) {
					pi.afl = bits.ReadInt8(data,offset+4);
					p++;
					ps--;
					if(pi.pf==0 && pi.afl!=183) {
						continue;
					}
					if(pi.pf && pi.afl>182) {
						continue;
					}
					p += pi.afl;
					ps -= pi.afl;
				}
				
				piTable[pi.pid] = pi;
				
				var processor = this[this.pidTable[pi.pid]];
				
				processor && processor.call(this,pi,data,offset+p,ps,dataOut);
				
			}
			this.walkThroughAvailPes(function(esi) {
				if((esi.videoPrevious && esi.videoPrevious.remains) || (esi.data && esi.data.length>0))
					this.pesPacketReady(esi,dataOut,true);
			});
		}
		callback(null,dataOut);
	},
		
	walkThroughAvailPes: function(callback) {
		for(var pid in this.pesTable) {
			var esi = this.pesTable[pid]; 
			if(esi.state=="started")
				callback.call(this,esi);
		}
	},
	
	processPAT: function(pi,data,offset,size,dataOut) {
		var w2 = bits.ReadInt32(data,offset);
		var ti = ((w2 & 0xff0000) >>> 16) >>> 0;
		var ssi = ((w2 & 0x8000) >>> 15) >>> 0;
		var dz = ((w2 & 0x4000) >>> 14) >>> 0;
		var sl = ((w2 & 0xfff)) >>> 0;
		var tsi = bits.ReadInt16(data,offset+4);
		var w3 = bits.ReadInt24(data,offset+6);
		var vn = ((w3 & 0x3e00) >>> 9) >>> 0;
		var cni = ((w3 & 0x100) >>> 8) >>> 0;
		var sn = ((w3 & 0xf0) >>> 4) >>> 0;
		var lsn = ((w3 & 0xf)) >>> 0;
		
		sl -= 5;
		
		if(ti || !ssi || dz) {
			console.info("MP2T/PAT Bad header");
			return false;
		}
		if(sl%4) {
			console.info("MP2T/PAT Bad section length");
			return false;
		}
		var pidCount = (sl - 4)/4;
		for(var i=0;i<pidCount;i++) {
			var w3 = bits.ReadInt32(data,offset+4+5+i*4);
			var pm = ((w3 & 0xffff0000) >>> 16) >>> 0;
			var pmtpid = (w3 & 0x1fff) >>> 0;
			this.pidTable[pmtpid] = "processPMT";
			this.pmtTable = this.pmtTable || {};
			this.pmtTable[pmtpid] = pm;
		}
		
		return true;
	},
	
	processPMT: function(pi,data,offset,size,dataOut) {
		var w2 = bits.ReadInt32(data,offset);
		var ti = ((w2 & 0xff0000) >>> 16) >>> 0;
		var ssi = ((w2 & 0x8000) >>> 15) >>>0;
		var dz = ((w2 & 0x4000) >>> 14) >>>0;
		var sl = (w2 & 0xfff) >>>0;
		var pn = bits.ReadInt16(data,offset+4);
		var w3 = bits.ReadInt24(data,offset+6);
		var vn = ((w3 & 0x3e00) >>> 9) >>>0;
		var cni = ((w3 & 0x100) >>> 8) >>>0;
		var sn = ((w3 & 0xf0) >>> 4) >>>0;
		var lsn = (w3 & 0xf) >>>0;
		
		if(!this.pmtTable) {
			console.info("MP2T/PMT No PMT table defined");
			return false;					
		}
		
		if(ti!=2 || !ssi || dz || sl>1021 || sn || lsn || pn!=this.pmtTable[pi.pid]) {
			console.info("MP2T/PMT Bad header",ti!=2,!ssi,dz,sl>1021,sn,lsn,pn,this.pmtTable[pi.pid]);
			return false;					
		}
		
		var w4 = bits.ReadInt32(data,offset+9);
		var pcr_pid = ((w4 & 0x1fff0000) >>> 16) >>>0;
		var pil = (w4 & 0xfff) >>>0;
			
		if(pil>=1024) {
			console.info("MP2T/PMT Bad program info length");
			return false;										
		}
		
		var es_offset = offset+13+pil;
		while(es_offset<offset+sl) {
			var st = bits.ReadInt8(data,es_offset);
			var w5 = bits.ReadInt32(data,es_offset+1);
			var pid = ((w5 & 0x1fff0000) >>> 16) >>>0;
			var eil = (w5 & 0xfff) >>>0;
		
			this.pesTable = this.pesTable || {};
		
			if(!this.pesTable[pid]) {
				var esi = {
					pid: pid,
					state: "initial",
					//dataOffsets: [],
					//dataSizes: [],
					//keyFrames: [],
					//dataTimestamps: [],
					dataTimestamp: -1,
					tsMin: Infinity,
					tsMax: 0,
					trackId: this.nextTrackId++,
					codecId: st,
					chunkNumber: 0,
				}
				esi.dataOffsets = this.ensureTransferable(esi,"dataOffsets");
				esi.dataSizes = this.ensureTransferable(esi,"dataSizes");
				esi.keyFrames = this.ensureTransferable(esi,"keyFrames");
				esi.dataTimestamps = this.ensureTransferable(esi,"dataTimestamps");
				this.pesTable[pid] = esi;
				this.pidTable[pid] = "processPES";
			}
			
			es_offset += 5 + eil;
		}
		
		return true;
	},
	
	validTimestampSection: function(ts) {
		var upper = bits.ReadInt8(ts,0);
		var lower = bits.ReadInt32(ts,1);
		return (lower & 0x1) && (lower & 0x10000) && (upper & 0x1);
	},
	
	timestampSection2Timestamp: function(ts) {
		var upper = bits.ReadInt8(ts,0);
		var lower = bits.ReadInt32(ts,1);
		
		var tsVal = ((upper & 0x7) << 32) + lower;
		
		return ((upper & 0x8) ? 0x100000000:0)
			+ ((upper & 0x4) ? 0x80000000:0)
			+ ((upper & 0x2) ? 0x40000000:0)
			+ (((lower & 0xfffe) >>> 1) >>>0)
			+ (((lower >>> 2) & 0x1fffc000) >>>0);
	},
	
	processPES(pi,data,offset,size,dataOut) {
	
		var pesDataOffset = offset; 
		var pesDataSize = size; 
		
		var esi = this.pesTable[pi.pid];
		if(pi.pusi) {
			if(esi.data && esi.data.length>0)
				this.pesPacketReady(esi,dataOut);
			
			var pscp = bits.ReadInt24(data,offset);
			var si = bits.ReadInt8(data,offset+3);
			var pl = bits.ReadInt16(data,offset+4);
			
			if((si & 0xe0) == 0xc0)
				esi.streamType = "audio";		
			else if((si & 0xf0) == 0xe0)
				esi.streamType = "video";
			else 
				return this.pesFailed(esi,dataOut);
		
			var codec = this.codecs[esi.codecId];
			if(codec) {
				esi.codec = codec;
				if(codec.type=="video") {
					if(!esi.width)
						esi.width = 0; 
					if(!esi.height)
						esi.height = 0;
				}
			} else
				return this.pesFailed(esi,dataOut,"Ignore unknown codec 0x"+esi.codecId.toString(16));
		
			esi.data=[];
			esi.packetLength = (pl && pl-3) || 0;
			esi.packetIndex = 0;
			esi.pscp = pscp;
			esi.si = si;
		
			offset+=6;
			size-=6;
			
			var pesHeader = {};
			var w = bits.ReadInt16(data,offset);
			if((w & 0xc000)!=0x8000)
				return this.pesFailed(esi,dataOut,"Invalid optional header starter");
			pesHeader.sc = ((w & 0x3000) >>> 12) >>>0;
			pesHeader.prio = ((w & 0x0800) >>> 11) >>>0;
			pesHeader.dai = ((w & 0x0400) >>> 10) >>>0;
			pesHeader.copyr = ((w & 0x0200) >>> 9) >>>0;
			pesHeader.ooc = ((w & 0x0100) >>> 8) >>>0;
			pesHeader.ptsdts = ((w & 0xc0) >>> 6) >>>0;
			if(pesHeader.ptsdts==0x01)
				return this.pesFailed(esi,dataOut,"Invalid optional header PTS DTS indicator");
			pesHeader.escr = ((w & 0x20) >>> 5) >>>0;
			pesHeader.esrf = ((w & 0x10) >>> 4) >>>0;
			pesHeader.dsmtmf = ((w & 0x08) >>> 3) >>>0;
			pesHeader.acif = ((w & 0x04) >>> 2) >>>0;
			pesHeader.crcf = ((w & 0x02) >>> 1) >>>0;
			pesHeader.ef = (w & 0x01) >>>0;
			
			var pesHeaderLength = bits.ReadInt8(data,offset+2);
			
			if(esi.packetLength)
				esi.packetLength -= pesHeaderLength;
			
			var headerOffset = offset+3;
			
			var timestamp = esi.lastTs || -1;
			
			var pts = null;
			if(pesHeader.ptsdts & 0x02) {
				pts = new Uint8Array(5);
				pts.set(data.subarray(headerOffset,headerOffset+5));
				if(!this.validTimestampSection(pts)) {
					console.warn("PES",pi.pid,"Invalid PTS timestamp");
					pts = null;					
				}
				if(pts)
					timestamp = this.timestampSection2Timestamp(pts);
				headerOffset += 5;
			}
			var dts = null;
			if(pesHeader.ptsdts & 0x01) {				
				dts = new Uint8Array(5);
				dts.set(data.subarray(headerOffset,headerOffset+5));
				headerOffset += 5;
				if(!this.validTimestampSection(dts))
					dts = null;					
				if(dts) {
					var ts = this.timestampSection2Timestamp(dts);
					if(ts>timestamp)
						timestamp = ts;
				}
			}
			
			if(timestamp>=0 && esi.dataTimestamp<0) {
				if(timestamp<esi.tsMin)
					esi.tsMin = timestamp;
				esi.tsMax = timestamp;
				esi.dataTimestamp = timestamp;
				esi.lastTs = timestamp;
				if(esi.sampleCount && timestamp > esi.tsMin)
					esi.sampleRate = (esi.sampleCount / (timestamp-esi.tsMin)) * 90000;
			}
			
			if(pesHeader.escr) {
				var escrU16 = bits.ReadInt16(data,headerOffset);
				var escrL32 = bits.ReadInt32(data,headerOffset+2);
				headerOffset += 6;
				if((escrU16 & 0xc004)!=4 || (escrU32 & 0x04000401)!=0x04000401)
					console.warn("PES",pi.pid,"Invalid ESCR");
				else
					esi.escr = ((escrU16 & 0x3800) << 18 | (escrU16 & 0x3f) << 19 |
						(escrL32 & 0xf8000000) >>> 13 | (escrL32 & 0x3fff800) >>> 2 | (escrL32 & 0x3fe) >>> 1) >>>0;
			}
			if(pesHeader.esrf) {
				var esrData = bits.ReadInt24(data,headerOffset);
				headerOffset += 3;
				if((esrData & 0x800001) != 0x800001)
					console.warn("PES",pi.pid,"Invalid ESR");
				else
					esi.esr = ((esrData & 0x7ffffe) >>> 1) >>>0;
			}
			if(pesHeader.acif) {
				var aciData = bits.ReadInt8(data,headerOffset);
				headerOffset += 1;
				if((aciData & 0x80) != 0x80)
					console.warn("PES",pi.pid,"Invalid ACI");
				else
					esi.aci = aciData & 0x7f;
			}
			
			offset += (3 + pesHeaderLength);
			size -= (3 + pesHeaderLength);
			
			pesDataOffset = offset; 
			pesDataSize = size; 
						
			if(pesDataSize<0)
				return this.pesFailed(esi,dataOut,"Header size exceed packet size");				
		
			if(esi.packetLength && esi.packetIndex>esi.packetLength)
				return this.pesFailed(esi,dataOut,"Data went beyond length on first segment");
		
			this.pesStarted(esi,dataOut);
			
		} else if(!esi.data)
			return true;
		
		if(esi.packetLength && esi.packetIndex>esi.packetLength)
			return this.pesFailed(esi,dataOut,"Data went beyond length "+esi.packetIndex+" "+esi.packetLength);
			
		var dataBuffer = data.subarray(pesDataOffset,pesDataOffset+pesDataSize);
		
		esi.data.push(dataBuffer);
		esi.packetIndex += size;
		
		if(esi.packetLength && esi.packetIndex>=esi.packetLength)
			this.pesPacketReady(esi,dataOut);
		
		return true;
	},
	
	pesFailed: function(esi,dataOut,reason) {
		esi.state = "failed";
		if(reason)
			console.warn("PES",esi.pid,"failure:",reason);
		delete this.pidTable[esi.pid];
		return false;
		},
		
		pesStarted: function(esi,dataOut) {
		if(esi.state=="started")
			return;
		esi.state = "started";
	},
	
	pesPacketReady(esi,dataOut,flush) {
	
		esi.mediaChunks = null;
		var skip = false;
		
		if(esi.streamType=="video" && esi.codecId==0x1b) {
			var query = {
				flush: flush,
				sps: !esi.sps,
				pps: !esi.pps,
				width: !esi.width,
				height: !esi.height,
				previous: esi.videoPrevious,
			}
		
			esi.data = this.flatten(esi.data);
			
			var t0 = Date.now();
			var meta = h264.extractMeta(query,esi.data);
			this.perfBytes = (this.perfBytes || 0) + esi.data.length;
			this.perfTime = (this.perfTime || 0) + (Date.now()-t0);
			
			esi.videoPrevious = meta.previous || null;
			if(query.width && meta.width)
				esi.width = meta.width; 
			if(query.height && meta.height)
				esi.height = meta.height; 
			if(query.sps && meta.sps)
				esi.sps = meta.sps; 				
			if(query.pps && meta.pps)
				esi.pps = meta.pps;
			if(meta.frame) {
				esi.sampleCount = (esi.sampleCount || 0) + 1;
				if(meta.frame.key)
					this.pushTransferable(esi,"keyFrames",this.lengthTransferable(esi,"dataSizes")+1);
				this.perfVideoSize = (this.perfVideoSize || 0)+meta.frame.size;
				this.pushTransferable(esi,"dataSizes",meta.frame.size);
				if(this.lengthTransferable(esi,"stsc")==0)
					this.pushTransferable(esi,"stsc",esi.chunkNumber+1,1,1);

				esi.chunkNumber++;
			}
			if(meta.avccData)
				esi.data = meta.avccData;
			else
				skip = true;			
		}
		
		if(esi.streamType=="audio" && esi.codecId==0xf) {
			esi.mediaChunks = [];
			esi.data = this.flatten(esi.data);				
			var query = {
				rate: true,
				frames: true,
			}				
			var meta = adts.extractMeta(query,esi.data);
			if(meta.rate)
				esi.declaredSampleRate = meta.rate;
			if(meta.maxBitrate)
				esi.maxBitrate = Math.max(esi.maxBitrate || 0,meta.maxBitrate);
			if(meta.durationSec)
				esi.durationSec = (esi.durationSec || 0) + meta.durationSec;
			esi.sampleCount = (esi.sampleCount || 0) + meta.frames.length;
			esi.sampleSizes = this.ensureTransferable(esi,"sampleSizes");
			for(var i=0;i<meta.frames.length;i++) {
				var frame = meta.frames[i];
				this.pushTransferable(esi,"sampleSizes",frame.s);
				esi.mediaChunks.push(frame.o);
				if(this.lengthTransferable(esi,"stsc")==0 || meta.frames.length!=this.getTransferable(esi,"stsc",(esi.stsc.length-3)+1))
					this.pushTransferable(esi,"stsc",esi.chunkNumber+1,1,1);
			}
		}
		
		if(!skip)
			this.pesSendPacket(esi,esi.data,dataOut);
		
		delete esi.data;
	},
	
	pesSendPacket: function(esi,packet,dataOut) {
		var dataLength = this.length(packet);
		dataOut.push(packet);
		if(esi.dataTimestamp<0)
			esi.dataTimestamp = 0;
		var dtsu = Math.floor(esi.dataTimestamp/0x100000000);
		var dtsl = (esi.dataTimestamp & 0xffffffff) >>> 0;
		this.pushTransferable(esi,"dataTimestamps",dtsu,dtsl);
		esi.dataTimestamp = -1;
		if(esi.mediaChunks) {
			var timestamp;
			for(var i=0;i<esi.mediaChunks.length;i++) {
				if(i==0)
					this.getTransferable(esi,"dataTimestamps",esi.dataTimestamps.length-1)
				else {
					var dts = timestamp + Math.round(i*90000/esi.declaredSampleRate);
					var dtsu = Math.floor(dts/0x100000000);
					var dtsl = (dts & 0xffffffff) >>> 0;
					this.pushTransferable(esi,"dataTimestamps",dtsu,dtsl);
				}
				this.pushTransferable(esi,"dataOffsets",this.processedChunksCount-1,this.dataOffset+esi.mediaChunks[i]);
			}
		} else
			this.pushTransferable(esi,"dataOffsets",this.processedChunksCount-1,this.dataOffset);
		this.dataOffset += dataLength;
	},

	ensureTransferable: function(esi,varName) {
		if(!esi[varName]) {
			var size = 10;
			esi[varName] = {
				size: size,
				length: 0,
				data: new Uint8Array(size*4),
			}
		}
		return esi[varName];
	},
	
	pushTransferable: function(esi,varName) {
		var tvar = this.ensureTransferable(esi,varName);
		var elements = Array.prototype.slice.call(arguments,2);
		while(tvar.length+elements.length>tvar.size) {
			var data = tvar.data;
			tvar.size = tvar.size * 2;
			tvar.data = new Uint8Array(tvar.size*4);
			tvar.data.set(data);
		}
		for(var i=0;i<elements.length;i++,tvar.length++)
			bits.WriteInt32(tvar.data,tvar.length*4,elements[i]);
	},

	lengthTransferable: function(esi,varName) {
		var tvar = this.ensureTransferable(esi,varName);
		return tvar.length;
	},
	
	getTransferable: function(esi,varName,index) {
		var tvar = this.ensureTransferable(esi,varName);
		if(index>=tvar.length)
			return undefined;
		return bits.ReadInt32(tvar.data,index*4);
	},

	flatten: function(data) {
		if(Array.isArray(data)) {
			var buffer = new Uint8Array(this.length(data));
			var offset = 0;
			function FlattenData(data) {
				if(Array.isArray(data)) {
					for(var i=0, l=data.length;i<l;i++)
						FlattenData(data[i]);
				} else {
					buffer.set(data,offset);
					offset += data.length;
				}
			}
			FlattenData(data);
			return buffer;
		} else
			return data;
	},

	length: function(data) {
		if(Array.isArray(data)) {
			var size = 0;
			for(var i=0, l=data.length;i<l;i++)
				size += this.length(data[i]);
			return size;
		} else
			return data.length;
	},
	
};

function processData(chunkSetData,data) {
	
	var chunkSet = new MP2TChunksetWorker(chunkSetData);
	
	var result = {
		meta: {},
	};

	var transferables = ["keyFrames","dataSizes","sampleSizes","dataTimestamps","dataOffsets","stsc"];

	chunkSet.walkThroughAvailPes(function(esi) {
		transferables.forEach(function(varName) {
			if(esi[varName]) {
				esi[varName].data = new Uint8Array(esi[varName].data); 
			}
		});
	});

	var transfers = [];
	chunkSet.processChunkData(new Uint8Array(data),function(err,dataOut) {
		if(dataOut) {
			var data = chunkSet.flatten(dataOut).buffer;
			result.data = data;
			transfers = transfers.concat([data]);
		}
		if(err)
			result.error = err.message;
	});
	
	chunkSet.walkThroughAvailPes(function(esi) {
		transferables.forEach(function(varName) {
			if(esi[varName]) {
				var buffer = esi[varName].data.buffer;
				esi[varName].data = buffer;
				transfers.push(buffer);
			}
		});
	});
	
	Object.keys(chunkSetData).forEach(function(field) {
		result.meta[field] = chunkSet[field];
	});

	return new PromiseWorker.Meta(result,{
		transfers: transfers
	});		
}
