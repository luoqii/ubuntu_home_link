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
const simplePrefs = require("sdk/simple-prefs");

const bits = require('./bits');
const masked = require('./masked');

function Box(boxType,data) {
	var length = Length(data);
	var boxLengthData = new Uint8Array(4);
	bits.WriteInt32(boxLengthData,0,8+length);
	boxType = (boxType+"    ").substr(0,4);
	return [boxLengthData,String2Buffer(boxType),data]
}

function BoxMvhd(chunkSet) {
	if(chunkSet.init && chunkSet.init.mvhd)
		return Box("mvhd",chunkSet.init.mvhd);

	var data = new Uint8Array(100);
	bits.WriteInt8(data,0,0);
	bits.WriteInt24(data,1,0);
	bits.WriteInt32(data,4,0);
	bits.WriteInt32(data,8,0);
	bits.WriteInt32(data,12,1000); // millisecs
	bits.WriteInt32(data,16,chunkSet.getTotalDuration());
	
	bits.WriteInt32(data,20,0x00010000);
	bits.WriteInt16(data,24,0x0100);
	MakeDefaultMatrix(data,36)
	bits.WriteInt32(data,72,0);
	bits.WriteInt32(data,76,0);
	bits.WriteInt32(data,80,0);
	bits.WriteInt32(data,84,0);
	bits.WriteInt32(data,88,0);
	bits.WriteInt32(data,92,0);

	bits.WriteInt32(data,96,chunkSet.getNextTrackId());
	
	return Box("mvhd",data);
}

function BoxTkhd(chunkSet,esi) {
	if(chunkSet.init && chunkSet.init.tkhd && chunkSet.init.tkhd[esi.trackId])
		return Box("tkhd",chunkSet.init.tkhd[esi.trackId]);

	var data = new Uint8Array(84);
	bits.WriteInt24(data,1,0x3);
	bits.WriteInt32(data,4,0);
	
	bits.WriteInt32(data,8,0);
	
	bits.WriteInt32(data,12,esi.trackId);
	// reserved 4 bytes
	bits.WriteInt32(data,20,chunkSet.getTrackDuration(esi));
	// reserved 8 bytes
	
	bits.WriteInt16(data,32,0);
	bits.WriteInt16(data,34,0);
	if(esi.streamType=="audio")
		bits.WriteInt16(data,36,0x0100);
	bits.WriteInt16(data,38,0);

	MakeDefaultMatrix(data,40);

	if(esi.streamType=="video") {
		bits.WriteInt16(data,76,esi.width);
		bits.WriteInt16(data,80,esi.height);
	}
	
	return Box("tkhd",data);
}

function BoxMdhd(chunkSet,esi) {
	if(chunkSet.init && chunkSet.init.mdhd && chunkSet.init.mdhd[esi.trackId])
		return Box("mdhd",chunkSet.init.mdhd[esi.trackId]);

	var data = new Uint8Array(24);

	bits.WriteInt32(data,0,0);
	bits.WriteInt32(data,4,0);
	bits.WriteInt32(data,8,0);
	if(esi.streamType=="video") {
		bits.WriteInt32(data,12,90000);
		var duration = chunkSet.getTrackDuration(esi)*90;
		bits.WriteInt32(data,16,duration);
	} else {
		bits.WriteInt32(data,12,esi.declaredSampleRate);
		var duration = esi.sampleCount*1024;
		bits.WriteInt32(data,16,duration);
	}
	bits.WriteInt16(data,20,0x55c4); // default lang
	bits.WriteInt16(data,22,0);

	return Box("mdhd",data);
}

function BoxVmhd(chunkSet,esi) {
	if(chunkSet.init && chunkSet.init.vmhd && chunkSet.init.vmhd[esi.trackId])
		return Box("vmhd",chunkSet.init.vmhd[esi.trackId]);

	var data = new Uint8Array(12);

	bits.WriteInt32(data,0,0x1);
	bits.WriteInt16(data,4,0);
	bits.WriteInt16(data,6,0);
	bits.WriteInt16(data,8,0);
	bits.WriteInt16(data,10,0);

	return Box("vmhd",data);
}

function BoxSmhd(chunkSet,esi) {
	if(chunkSet.init && chunkSet.init.smhd && chunkSet.init.smhd[esi.trackId])
		return Box("smhd",chunkSet.init.smhd[esi.trackId]);
	var data = new Uint8Array(8);
	bits.WriteInt32(data,0,0);
	bits.WriteInt16(data,4,0);
	bits.WriteInt16(data,6,0);
	return Box("smhd",data);
}

function BoxElst(chunkSet,esi) {
	var data = new Uint8Array(20);
	bits.WriteInt32(data,0,0);
	bits.WriteInt32(data,4,1);
	bits.WriteInt32(data,8,chunkSet.getTrackDuration(esi));
	bits.WriteInt32(data,12,esi.shiftTs);
	bits.WriteInt16(data,16,1);
	bits.WriteInt16(data,18,0);

	return Box("elst",data);
}

function BoxEdts(chunkSet,esi) {
	if(chunkSet.init && chunkSet.init.edts)
		if(chunkSet.init.edts[esi.trackId])
			return Box("edts",chunkSet.init.edts[esi.trackId]);
		else
			return [];

	if(!esi.shiftTs)
		return [];

	var elstBox = BoxElst(chunkSet,esi);
	return Box("edts",elstBox);
}

function BoxHdlr(chunkSet,esi) {
	if(chunkSet.init && chunkSet.init.hdlr && chunkSet.init.hdlr[esi.trackId])
		return Box("hdlr",chunkSet.init.hdlr[esi.trackId]);
	
	var componentName = "VideoHandler";
	var data = new Uint8Array(25+componentName.length);
	bits.WriteInt32(data,0,0);
	if(esi.streamType=='audio')
		String2Buffer("mhlr",data,4);
	if(esi.streamType=="audio")
		String2Buffer("soun",data,8);
	else if(esi.streamType=="video")
		String2Buffer("vide",data,8);
	bits.WriteInt32(data,12,0);
	bits.WriteInt32(data,16,0);
	bits.WriteInt32(data,20,0);
	String2Buffer(componentName,data,24);
	return Box("hdlr",data);
}

function BoxStsz(chunkSet,esi) {
	if(esi.sampleSizes) {
		var sameSize = true;
		var sampleSize;
		if(Array.isArray(esi.sampleSizes)) {
			sampleSize = esi.sampleSizes[0];
			for(var i=1;i<esi.sampleSizes.length;i++)
				if(esi.sampleSizes[i]!=sampleSize) {
					sameSize = false;
					break;
				}
		} else {
			sampleSize = bits.ReadInt32(esi.sampleSizes.data,0);
			for(var i=1;i<esi.sampleSizes.length;i++)
				if(bits.ReadInt32(esi.sampleSizes.data,i*4)!=sampleSize) {
					sameSize = false;
					break;
				}
		}
		var data;
		if(sameSize) {
			data = new Uint8Array(12);
			bits.WriteInt32(data,4,sampleSize);
		} else {
			data = new Uint8Array(12+4*esi.sampleSizes.length);
			if(Array.isArray(esi.sampleSizes))
				for(var i=0;i<esi.sampleSizes.length;i++)
					bits.WriteInt32(data,12+i*4,esi.sampleSizes[i]);
			else
				data.set(esi.sampleSizes.data.subarray(0,esi.sampleSizes.length*4),12);
		}
		bits.WriteInt32(data,8,esi.sampleSizes.length);
		return Box('stsz',data);		
	}
	var stsz = new Uint8Array(esi.dataSizes.length*4+12);
	bits.WriteInt32(stsz,4,0);
	bits.WriteInt32(stsz,8,esi.dataSizes.length);
	if(Array.isArray(esi.dataSizes))
		for(var i=0;i<esi.dataSizes.length;i++)
			bits.WriteInt32(stsz,12+i*4,esi.dataSizes[i]);
	else
		stsz.set(esi.dataSizes.data.subarray(0,esi.dataSizes.length*4),12);
	return Box('stsz',stsz);
}

function BoxAvcC(chunkSet,esi) {
	if(!esi.sps || !esi.pps)
		return [];
	var sps = new Uint8Array(esi.sps);
	var pps = new Uint8Array(esi.pps);
	var data = new Uint8Array(11 + sps.length + pps.length);
	bits.WriteInt8(data,0,0x1);
	bits.WriteInt8(data,1,sps[1]);
	bits.WriteInt8(data,2,sps[2]);
	bits.WriteInt8(data,3,sps[3]);
	bits.WriteInt8(data,4,0xff);
	bits.WriteInt8(data,5,0xe1);

	bits.WriteInt16(data,6,sps.length);
	data.set(sps,8);
	
	var offset = 8+sps.length;
	bits.WriteInt8(data,offset,0x1);
	bits.WriteInt16(data,offset+1,pps.length);
	data.set(pps,offset+3);
	
	return Box('avcC',data);	
}

function BoxAvc1(chunkSet,esi) {
	var data = new Uint8Array(78);
	bits.WriteInt32(data,0,0);
	bits.WriteInt16(data,4,0); 		
	bits.WriteInt16(data,6,0x1); 		

	bits.WriteInt16(data,8,0); 		
	bits.WriteInt16(data,10,0); 		

	bits.WriteInt32(data,12,0); 		
	bits.WriteInt32(data,16,0); 		
	bits.WriteInt32(data,20,0); 		

	bits.WriteInt16(data,24,esi.width); 		
	bits.WriteInt16(data,26,esi.height); 		

	bits.WriteInt32(data,28,0x00480000); 		
	bits.WriteInt32(data,32,0x00480000); 		

	bits.WriteInt32(data,36,0); 		
	bits.WriteInt16(data,40,0x1); 		

	// compressor name: leave next 32 bytes to 0
	
	bits.WriteInt16(data,74,0x18);
	bits.WriteInt16(data,76,0xffff);
	
	var avccBox = BoxAvcC(chunkSet,esi);
	
	return Box('avc1',[data,avccBox]);
}

function BoxEsds(chunkSet,esi) {
	var codecExtraLen = 0;
	var data = new Uint8Array(36+codecExtraLen);

	bits.WriteInt32(data,0,0); 		

	WriteDescr(data,4,3,27+codecExtraLen);
	
	bits.WriteInt16(data,9,esi.trackId);
	bits.WriteInt8(data,11,0);
	
	WriteDescr(data,12,4,13+codecExtraLen);
	
	bits.WriteInt8(data,17,0x40); // codec tag
	bits.WriteInt8(data,18,0x15);
	bits.WriteInt24(data,19,0);
	
	var maxBitrate = Math.round(esi.maxBitrate) || 0;
	bits.WriteInt32(data,22,maxBitrate); 
	bits.WriteInt32(data,26,0); 
	// codec extra insert here
	
	WriteDescr(data,30,6,1);
	bits.WriteInt8(data,35,2);

	return Box('esds',data);
}

function BoxMp4a(chunkSet,esi) {
	var data = new Uint8Array(28);

	bits.WriteInt32(data,0,0); 		
	bits.WriteInt32(data,4,0x1); 		
	bits.WriteInt32(data,8,0); 		
	bits.WriteInt32(data,12,0); 		

	bits.WriteInt16(data,16,2); 		
	bits.WriteInt16(data,18,16); 		
	bits.WriteInt16(data,20,0);
	
	bits.WriteInt16(data,22,0);
	var sampleRate = (chunkSet.mpd && chunkSet.mpd.sample_rate) || esi.declaredSampleRate || esi.sampleRate || 0xbb80;
	bits.WriteInt16(data,24,sampleRate);
	bits.WriteInt16(data,26,0); 		
	
	var esdsBox = BoxEsds(chunkSet,esi);
	return Box('mp4a',[data,esdsBox]);
}

function BoxStsc(chunkSet,esi) {
	if(esi.stsc) {
		var stscLength = Array.isArray(esi.stsc) ? esi.stsc.length : esi.stsc.length/3;
		var data = new Uint8Array(8+12*stscLength);
		bits.WriteInt32(data,0,0);
		bits.WriteInt32(data,4,stscLength);
		if(Array.isArray(esi.stsc))
			for(var i=0;i<esi.stsc.length;i++) {
				var entry = esi.stsc[i];
				bits.WriteInt32(data,8+12*i,entry.first_chunk+1);
				bits.WriteInt32(data,8+12*i+4,entry.samples_per_chunk);
				bits.WriteInt32(data,8+12*i+8,entry.sample_description_index+1);
			}
		else
			data.set(esi.stsc.data.subarray(0,esi.stsc.length*4),8);
		return Box('stsc',data);
	}
	
	var data = new Uint8Array(20);
	bits.WriteInt32(data,0,0);
	bits.WriteInt32(data,4,0x1);
	bits.WriteInt32(data,8,0x1);
	bits.WriteInt32(data,12,0x1);
	bits.WriteInt32(data,16,0x1);
	return Box('stsc',data);
}

function BoxStsd(chunkSet,esi) {
	if(chunkSet.init && chunkSet.init.stsd && chunkSet.init.stsd[esi.trackId])
		return Box("stsd",chunkSet.init.stsd[esi.trackId]);
	
	var data = new Uint8Array(8);
	bits.WriteInt32(data,0,0);
	bits.WriteInt32(data,4,0x1);
	var sampDescr = [];
	if(esi.streamType=="audio") {
		if(esi.codec.strTag=="mp4a")
			sampDescr = BoxMp4a(chunkSet,esi);		
	} else if(esi.streamType=="video") {
		if(esi.codec.strTag=="avc1")
			sampDescr = BoxAvc1(chunkSet,esi);
	}
	
	return Box('stsd',[data,sampDescr]);
}

function BoxStts(chunkSet,esi) {
	
	if(esi.stts) {
		var data = new Uint8Array(8+8*esi.stts.length);
		bits.WriteInt32(data,0,0);
		bits.WriteInt32(data,4,esi.stts.length);
		for(var i=0;i<esi.stts.length;i++) {
			var entry = esi.stts[i];
			bits.WriteInt32(data,8+8*i,entry.c);
			bits.WriteInt32(data,8+8*i+4,entry.d);
		}
		return Box("stts",data);
	}

	var stts = [];
	var dataTimestampsLength = Array.isArray(esi.dataTimestamps) ? esi.dataTimestamps.length : esi.dataTimestamps.length/2; 
	for(var i=0;i<dataTimestampsLength;) {
		var duration = 0;
		var ahead=1;
		if(Array.isArray(esi.dataTimestamps))
			for(;i+ahead<dataTimestampsLength && esi.dataTimestamps[i+ahead]<=esi.dataTimestamps[i];ahead++);
		else {
			for(;i+ahead<dataTimestampsLength && bits.ReadInt64(esi.dataTimestamps.data,(i+ahead)*8)<=bits.ReadInt64(esi.dataTimestamps.data,i*8);ahead++);
		}
		if(i+ahead<dataTimestampsLength) {
			if(Array.isArray(esi.dataTimestamps))
				duration = (esi.dataTimestamps[i+ahead] - esi.dataTimestamps[i])/ahead;
			else
				duration = (bits.ReadInt64(esi.dataTimestamps.data,(i+ahead)*8) - bits.ReadInt64(esi.dataTimestamps.data,i*8))/ahead;
			if(esi.declaredSampleRate)
				duration = Math.round(duration * esi.declaredSampleRate / 90000);
		}
		i+=ahead;
		if(duration && (stts.length==0 || stts[stts.length-1].duration!=duration))
			stts.push({
				duration: duration,
				count: ahead,
			})
		else if(stts.length>0)
			stts[stts.length-1].count+=ahead;
	}

	var data = new Uint8Array(8+8*stts.length);
	bits.WriteInt32(data,0,0);
	bits.WriteInt32(data,4,stts.length);
	for(var i=0;i<stts.length;i++) {
		bits.WriteInt32(data,8+8*i,stts[i].count);
		bits.WriteInt32(data,12+8*i,stts[i].duration);
	}
	return Box("stts",data);
}

function BoxStss(chunkSet,esi) {
	var data = new Uint8Array(8+4*esi.keyFrames.length);
	bits.WriteInt32(data,0,0);
	bits.WriteInt32(data,4,esi.keyFrames.length);
	if(Array.isArray(esi.keyFrames)) {
		for(var i=0;i<esi.keyFrames.length;i++)
			bits.WriteInt32(data,8+4*i,esi.keyFrames[i]+1);		
	} else {
		data.set(esi.keyFrames.data.subarray(0,esi.keyFrames.length*4),8);
	}
	return Box("stss",data);
}

function BoxStco(chunkSet,esi) {
	var dataOffsetsLength = Array.isArray(esi.dataOffsets) ? esi.dataOffsets.length : esi.dataOffsets.length/2; 
	var data = new Uint8Array(8+dataOffsetsLength*4);
	bits.WriteInt32(data,0,0);
	bits.WriteInt32(data,4,dataOffsetsLength);
	for(var i=0;i<dataOffsetsLength;i++) {
		var dataOffset;
		if(Array.isArray(esi.dataOffsets))
			dataOffset = esi.dataOffsets[i];
		else
			dataOffset = {
				b: bits.ReadInt32(esi.dataOffsets.data,i*8),
				o: bits.ReadInt32(esi.dataOffsets.data,i*8+4),
			}
		var offset = dataOffset.o+chunkSet.mdatOffsets[dataOffset.b];
		bits.WriteInt32(data,8+i*4,offset);
	}
	return Box('stco',data);
}

function BoxCo64(chunkSet,esi) {
	var dataOffsetsLength = Array.isArray(esi.dataOffsets) ? esi.dataOffsets.length : esi.dataOffsets.length/2; 
	var data = new Uint8Array(8+dataOffsetsLength*8);
	bits.WriteInt32(data,0,0);
	bits.WriteInt32(data,4,dataOffsetsLength);
	for(var i=0;i<dataOffsetsLength;i++) {
		var dataOffset;
		if(Array.isArray(esi.dataOffsets))
			dataOffset = esi.dataOffsets[i];
		else
			dataOffset = {
				b: bits.ReadInt32(esi.dataOffsets.data,i*8),
				o: bits.ReadInt32(esi.dataOffsets.data,i*8+4),
			}
		var offset = dataOffset.o+chunkSet.mdatOffsets[dataOffset.b];
		bits.WriteInt32(data,8+i*8,Math.floor(offset/0x100000000));
		bits.WriteInt32(data,12+i*8,offset & 0xffffffff);
	}
	return Box('co64',data);
}

function BoxStbl(chunkSet,esi) {
	var stsdBox = BoxStsd(chunkSet,esi);	
	var stszBox = BoxStsz(chunkSet,esi);	
	var sttsBox = BoxStts(chunkSet,esi);
	var stssBox = esi.streamType=="video"?BoxStss(chunkSet,esi):[];
	var stscBox = BoxStsc(chunkSet,esi);
	var stcoBox = chunkSet.multiMdat ? BoxCo64(chunkSet,esi) : BoxStco(chunkSet,esi);
		
	return Box("stbl",[stsdBox,sttsBox,stssBox,stscBox,stszBox,stcoBox]);
}

function BoxMinf(chunkSet,esi) {

	var vmhdBox = esi.streamType=="video" ? BoxVmhd(chunkSet,esi) : [];
	var smhdBox = esi.streamType=="audio" ? BoxSmhd(chunkSet,esi) : [];
	var dinfBox = BoxDinf(chunkSet,esi);
	var stblBox = BoxStbl(chunkSet,esi);
	
	return Box("minf",[vmhdBox,smhdBox,dinfBox,stblBox]);
}

function BoxMdia(chunkSet,esi) {
	var mdhdBox = BoxMdhd(chunkSet,esi);
	var hdlrBox = BoxHdlr(chunkSet,esi);
	var minfBox = BoxMinf(chunkSet,esi);
	return Box("mdia",[mdhdBox,hdlrBox,minfBox]);
}

function BoxUrl(chunkSet,esi) {
	var data = new Uint8Array(4);

	bits.WriteInt32(data,0,0x1);

	return Box("url ",data);
}

function BoxDref(chunkSet,esi) {
	var data = new Uint8Array(8);
	bits.WriteInt32(data,0,0);
	bits.WriteInt32(data,4,0x1);
	var urlBox = BoxUrl(chunkSet,esi);
	return Box("dref",[data,urlBox]);
}

function BoxDinf(chunkSet,esi) {
	if(chunkSet.init && chunkSet.init.dinf && chunkSet.init.dinf[esi.trackId])
		return Box("dinf",chunkSet.init.dinf[esi.trackId]);	
	
	var drefBox = BoxDref(chunkSet,esi);
	return Box("dinf",drefBox);
}

function BoxIods(chunkSet) {
	if(chunkSet.init && chunkSet.init.iods && chunkSet.init.iods)
		return Box("iods",chunkSet.init.iods);

	var data = new Uint8Array(16);
	bits.WriteInt32(data,0,0);
	bits.WriteInt8(data,4,0x10);
	bits.WriteInt32(data,5,0x80808007);
	bits.WriteInt16(data,9,0x004f);
	bits.WriteInt16(data,11,0xffff);
	bits.WriteInt16(data,13,0xfefe);
	bits.WriteInt8(data,15,0xff);
	return Box("iods",data);
}

function WriteDescr(data,offset,tag,size) {
    var i = 3;
    bits.WriteInt8(data,offset++,tag);
    for (; i > 0; i--)
        bits.WriteInt8(data,offset++,((size >>> (7 * i)) | 0x80) >>>0);
    bits.WriteInt8(data,offset++,size & 0x7F);
}

function String2Buffer(str,buffer,offset) {
	buffer = buffer || new Uint8Array(str.length);
	offset = offset || 0;
	for(var i=0, l=str.length;i<l;i++)
		buffer[offset+i] = str.charCodeAt(i) & 0xff;
	return buffer;
}

function Length(data) {
	if(Array.isArray(data)) {
		var size = 0;
		for(var i=0, l=data.length;i<l;i++)
			size += Length(data[i]);
		return size;
	} else
		return data.length;
}

function Flatten(data) {
	if(Array.isArray(data)) {
		var buffer = new Uint8Array(Length(data));
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
}

function FirstBuffer(data) {
	if(Array.isArray(data))
		if(data.length==0)
			return null;
		else
			return FirstBuffer(data[0]);
	else
		return data;
}

function MakeDefaultMatrix(data,offset) {
	[0x00010000,0,0,0,0x00010000,0,0,0,0x40000000].forEach(function(val,index) {
		bits.WriteInt32(data,offset+4*index,val);
	});
}

function WriteMulti(file,data,callback) {
	var t0 = Date.now();
	data = Flatten(data);
	
	var dataLength = data.length;
	
	file.write(data).then(function() {
		callback(null);
	},function(err) {
		callback(err);
	});
}

exports.length = Length;
exports.flatten = Flatten;
exports.firstBuffer = FirstBuffer;
exports.writeMulti = WriteMulti;

exports.finalize = function(chunkSet,esis,downloadTarget,callback) {

	function DoMoveAndMask() {
		OS.File.move(chunkSet.downloadTarget+".part",chunkSet.downloadTarget).then(function() {
			if(chunkSet.masked && chunkSet.action) {
				var files = masked.makeFileNames(chunkSet.downloadTarget);
				masked.finalize(chunkSet.action,files.manifestFilePath,function(err) {
					chunkSet.action.hit.data._finalLocalFilePath = files.manifestFilePath;
					callback(err);
				});
			} else
				callback(null);
		},callback);
	}

	function DoFinalize() {
		var traks = [];
		
		esis.forEach(function(esi) {
			var tkhdBox = BoxTkhd(chunkSet,esi);
			var mdiaBox = BoxMdia(chunkSet,esi);
			var edtsBox = BoxEdts(chunkSet,esi);
			var trakBox = Box('trak',[tkhdBox,edtsBox,mdiaBox]);
			traks.push(trakBox);
		});
		
		var mvhdBox = BoxMvhd(chunkSet);
		var iodsBox = BoxIods(chunkSet);
		var moovBox = Box('moov',[mvhdBox, iodsBox, traks]);
	
		var fileProvider = OS;
		var fileOptions = {
				write:true,
				append:false,
		}
		if(chunkSet.masked) {
			fileProvider = masked;
			fileOptions.iv = chunkSet.biniv;
			fileOptions.key = chunkSet.cryptoKey;
		}

		fileProvider.File.open(chunkSet.downloadTarget+".part",fileOptions)
		.then(function(file) {
			file.setPosition(0,OS.File.POS_END).then(function() {
				WriteMulti(file,moovBox,function(err) {
					file.close();
					if(err) {
						return callback(err);
					}
					DoMoveAndMask();
				});
			},function(err) {
				callback(err);			
			});
		},function(err) {
			callback(err);
		});
	}
	if(simplePrefs.prefs['hls.download-as-m2ts'])
		DoMoveAndMask();
	else if(chunkSet.currentDataBlockSize>0)
		exports.updateMdatLength(chunkSet,
								 chunkSet.mdatLengthOffset,
								 chunkSet.currentDataBlockSize,function(err) {
			if(err)
				return callback(err);
			else
				DoFinalize();
		});
	else
		DoFinalize();
}

exports.writeFileHeader = function(chunkSet,callback) {
	var ftypBox;
	if(chunkSet.init && chunkSet.init.ftyp)
		ftypBox = Box("ftyp",chunkSet.init.ftyp);
	else {
		var ftypExtra = new Uint8Array(4);
		bits.WriteInt32(ftypExtra,0,0x00000200);
		ftypBox = Box("ftyp",[String2Buffer("isom"),ftypExtra,String2Buffer("isomiso2avc1mp41")]);
	}
	var freeBox = Box("free",[]);
	chunkSet.fileSize = chunkSet.lastDataIndex = Length(ftypBox)+Length(freeBox);
		
	var fileProvider = OS;
	var fileOptions = {
			write:true,
			append:false,
			truncate:true,
	}
	if(chunkSet.masked) {
		fileProvider = masked;
		fileOptions.iv = chunkSet.biniv;
		fileOptions.key = chunkSet.cryptoKey;
	}
	fileProvider.File.open(chunkSet.downloadTarget+".part",fileOptions,{unixMode:0o644})
	.then(function(file) {
		WriteMulti(file,[ftypBox,freeBox/*,mdatBox*/],function(err) {
			file.close();
			if(err)
				callback(err);
			else
				callback(null);
		});
	},function(err) {
		callback(err);
	});
}

exports.updateMdatLength = function(chunkSet,position,dataSize,callback) {
	var fileProvider = OS;
	var fileOptions = {
			write:true,
			append:false,
	}
	if(chunkSet.masked) {
		fileProvider = masked;
		fileOptions.iv = chunkSet.biniv;
		fileOptions.key = chunkSet.cryptoKey;
	}
	fileProvider.File.open(chunkSet.downloadTarget+".part",fileOptions)
	.then(function(file) {
		file.setPosition(position,OS.File.POS_START).then(function() {
			var lengthData = new Uint8Array(4);
			bits.WriteInt32(lengthData,0,dataSize + 8);
			
			file.write(lengthData).then(function() {
				file.close();
				callback(null);
			},function(err) {
				file.close();
				callback(err);
			});
		},function(err) {
			file.close();
			callback(err);
		});
	},function(err) {
		callback(err);
	});	
}

function Parse(data,length) {
	length = length || data.length;
	var offset = 0;
	var tags = [];
	while(1) {
		if(length==0)
			return tags;
		if(length<8)
			return null;
		var boxLength = bits.ReadInt32(data,offset);
		if(boxLength>length || boxLength<8)
			return null;
		var tagName = String.fromCharCode(
				bits.ReadInt8(data,offset+4),
				bits.ReadInt8(data,offset+5),
				bits.ReadInt8(data,offset+6),
				bits.ReadInt8(data,offset+7)
		);
		tags.push({
			name: tagName,
			offset: offset,
			length: boxLength,
			dataOffset: offset+8,
			dataLength: boxLength-8,
			data: data.subarray(offset+8,offset+boxLength),
		});
		offset += boxLength;
		length -= boxLength;
	}
}

function GetTags(tagName,data,length) {
	var tags = [];
	var allTags = Parse(data,length);
	if(!allTags)
		return tags;
	for(var i=0,l=allTags.length;i<l;i++) {
		var tag = allTags[i];
		if(tag.name==tagName)
			tags.push(tag);
	}
	return tags;
}

exports.parse = Parse;
exports.getTags = GetTags;
exports.mdatBox = function() {
	return Box("mdat",[]);
}
