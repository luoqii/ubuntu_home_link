/* Copyright (C) 2006-2016 Michel Gutierrez <mig@downloadhelper.net>
 * All Rights Reserved
 * 
 * If you are interested in methods used in this project, follow the
 * open source project at https://github.com/mi-g/fang
 */


const bits = require("resource://b9db16a4-6edc-47ec-a1f4-b86292ed211d/lib/bits.js");

const samplingFreq = {
    0: 96000,
    1: 88200,
    2: 64000,
    3: 48000,
    4: 44100,
    5: 32000,
    6: 24000,
    7: 22050,
    8: 16000,
    9: 12000,
    10: 11025,
    11: 8000,
    12: 7350,
}

exports.extractMeta = function(query,data) {
	var length=data.length, limit = length - 7;
	var meta = {
		start: -1,
		end: 0,
		maxBitrate: 0,
		durationSec: 0,
	};
	if(query.frames)
		meta.frames = [];
	for(var offset = 0; offset<limit;) {
		if(data[offset]==0xff && (data[offset+1]&0xf6)==0xf0) {
			if(meta.start<0)
				meta.start = offset;
			var w2 =  bits.ReadInt32(data,offset+3);
			var flen = ((w2 & 0x03ffe000) >>> 13) >>>0;
			if(query.frames)
				meta.frames.push({
					o: offset,
					s: flen,
				});
			if(query.rate) {
				var w1 = bits.ReadInt24(data,offset+1);
				var msfi = ((w1 & 0x3c00) >>> 10) >>>0;
				meta.rate = Math.round(samplingFreq[msfi]);
				meta.maxBitrate = Math.max(meta.maxBitrate,(flen*8)*meta.rate/1024); 
				meta.durationSec += 1024/meta.rate;
			}
			offset += flen;
			meta.end = offset;
		} else
			offset++;
	}
	return meta;
}
