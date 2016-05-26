/* Copyright (C) 2006-2016 Michel Gutierrez <mig@downloadhelper.net>
 * All Rights Reserved
 * 
 * If you are interested in methods used in this project, follow the
 * open source project at https://github.com/mi-g/fang
 */


/*
const $chrome = require("chrome");
const Cc = $chrome.Cc;
const Ci = $chrome.Ci;
const Cu = $chrome.Cu;
const $osfile = Cu.import("resource://gre/modules/osfile.jsm", {});
const OS = $osfile.OS;
*/
//var bits = require('./bits');
const bits = require("resource://b9db16a4-6edc-47ec-a1f4-b86292ed211d/lib/bits.js");

function assert(expr) {
	if(!expr)
		throw new Error("ASSERT");
}

function ReadBit(ctx) {
    assert(ctx.m_nCurrentBit <= ctx.m_nLength * 8);
    var nIndex = (ctx.m_nCurrentBit >>> 3) >>>0;
    var nOffset = ctx.m_nCurrentBit % 8 + 1;

    ctx.m_nCurrentBit ++;
    return ((ctx.m_pStart[ctx.offset+nIndex] >>> (8-nOffset)) & 0x01) >>>0;
}

function ReadBits(ctx,n) {
    var r = 0;
    for (var i = 0; i < n; i++) {
        r |= ( ReadBit(ctx) << ( n - i - 1 ) );
    }
    return r;
}

function ReadExponentialGolombCode(ctx) {
    var r = 0, i = 0;
    while( (ReadBit(ctx) == 0) && (i < 32) )
        i++;
    r = ReadBits(ctx,i);
    r += (1 << i) - 1;
    return r;
}

function ReadSE(ctx) {
    var r = ReadExponentialGolombCode(ctx);
    if (r & 0x01)
        r = (r+1)/2;
    else
        r = -(r/2);
    return r;
}

function FindNextOffset2(data, offset, size) {
	var a = 4 - (offset & 3);

	for(size-=3; offset < a && offset < size; offset++)
		if(data[offset]==0 && data[offset+1]==0 && data[offset+2]==1)
			return offset;
	
	for(size-=3; offset < size; offset+=4) {
		var x = bits.ReadInt32(data,offset);
        if ((x - 0x01010101) & (~x) & 0x80808080) {
            if (data[offset+1] == 0) {
                if (data[offset] == 0 && data[offset+2] == 1)
                    return offset;
                if (data[offset+2] == 0 && data[offset+3] == 1)
                    return offset+1;
            }
            if (data[offset+3] == 0) {
                if (data[offset+2] == 0 && data[offset+4] == 1)
                    return offset+2;
                if (data[offset+4] == 0 && data[offset+5] == 1)
                    return offset+3;
            }        	
        }
	}
	
    for (size += 3; offset < size; offset++) {
        if (data[offset] == 0 && data[offset+1] == 0 && data[offset+2] == 1)
            return offset;
    }

    return size + 3;
}

function FindNextOffset(data, offset, size) {
	var offset2 = FindNextOffset2(data, offset, size);
    if(offset<offset2 && offset2<size && !data[offset2-1]) 
    	offset2--;
    return offset2;
}

function ParseNalUnits(data,offset,size) {
	var units = [];
	var nalStart = FindNextOffset(data, offset, size);
	while(1) {
		while(nalStart<size && !data[nalStart++]);
		if(nalStart==size)
			break;
		var nalEnd = FindNextOffset(data, nalStart, size);
		units.push({
			o: nalStart,
			s: nalEnd - nalStart,
			data: data,
		});
		nalStart = nalEnd;
	}
	return units;
}

function ParseSps(pStart,offset,nLen) {
	
	var ctx = {
	    m_pStart: pStart,
	    m_nLength: nLen,
	    m_nCurrentBit: 0,
	    offset: offset,
	};

    var frame_crop_left_offset=0;
    var frame_crop_right_offset=0;
    var frame_crop_top_offset=0;
    var frame_crop_bottom_offset=0;

    var profile_idc = ReadBits(ctx,8);
    var constraint_set0_flag = ReadBit(ctx);
    var constraint_set1_flag = ReadBit(ctx);
    var constraint_set2_flag = ReadBit(ctx);
    var constraint_set3_flag = ReadBit(ctx);
    var constraint_set4_flag = ReadBit(ctx);
    var constraint_set5_flag = ReadBit(ctx);
    var reserved_zero_2bits  = ReadBits(ctx,2);
    
    var compatibility = (constraint_set0_flag << 7) | (constraint_set1_flag << 6) | (constraint_set2_flag << 5) | 
    	(constraint_set3_flag << 4) | (constraint_set4_flag << 3) | 
    	(constraint_set5_flag << 2) | reserved_zero_2bits;
    
    var level_idc = ReadBits(ctx,8);
    var seq_parameter_set_id = ReadExponentialGolombCode(ctx);

    if( profile_idc == 100 || profile_idc == 110 ||
        profile_idc == 122 || profile_idc == 244 ||
        profile_idc == 44 || profile_idc == 83 ||
        profile_idc == 86 || profile_idc == 118 ) {
        var chroma_format_idc = ReadExponentialGolombCode(ctx);

        if(chroma_format_idc == 3 ) {
            var residual_colour_transform_flag = ReadBit(ctx);
        }
        var bit_depth_luma_minus8 = ReadExponentialGolombCode(ctx);
        var bit_depth_chroma_minus8 = ReadExponentialGolombCode(ctx);
        var qpprime_y_zero_transform_bypass_flag = ReadBit(ctx);
        var seq_scaling_matrix_present_flag = ReadBit(ctx);

        if(seq_scaling_matrix_present_flag) {
            for (var i = 0; i < 8; i++) {
                var seq_scaling_list_present_flag = ReadBit(ctx);
                if(seq_scaling_list_present_flag) {
                    var sizeOfScalingList = (i < 6) ? 16 : 64;
                    var lastScale = 8;
                    var nextScale = 8;
                    for (var j = 0; j < sizeOfScalingList; j++) {
                        if (nextScale != 0) {
                            var delta_scale = ReadSE(ctx);
                            nextScale = (lastScale + delta_scale + 256) % 256;
                        }
                        lastScale = (nextScale == 0) ? lastScale : nextScale;
                    }
                }
            }
        }
    }

    var log2_max_frame_num_minus4 = ReadExponentialGolombCode(ctx);
    var pic_order_cnt_type = ReadExponentialGolombCode(ctx);
    if(pic_order_cnt_type == 0) {
        var log2_max_pic_order_cnt_lsb_minus4 = ReadExponentialGolombCode(ctx);
    } else if(pic_order_cnt_type == 1) {
        var delta_pic_order_always_zero_flag = ReadBit(ctx);
        var offset_for_non_ref_pic = ReadSE(ctx);
        var offset_for_top_to_bottom_field = ReadSE(ctx);
        var num_ref_frames_in_pic_order_cnt_cycle = ReadExponentialGolombCode(ctx);
        var ref_frames_in_pic_order_cnt_cycle = [];
        for(var i = 0; i < num_ref_frames_in_pic_order_cnt_cycle; i++ )
        	ref_frames_in_pic_order_cnt_cycle.push(ReadSE(ctx));
    }
    var max_num_ref_frames = ReadExponentialGolombCode(ctx);
    var gaps_in_frame_num_value_allowed_flag = ReadBit(ctx);
    var pic_width_in_mbs_minus1 = ReadExponentialGolombCode(ctx);
    var pic_height_in_map_units_minus1 = ReadExponentialGolombCode(ctx);
    var frame_mbs_only_flag = ReadBit(ctx);
    if(!frame_mbs_only_flag) {
        var mb_adaptive_frame_field_flag = ReadBit(ctx);
    }
    var direct_8x8_inference_flag = ReadBit(ctx);
    var frame_cropping_flag = ReadBit(ctx);
    if( frame_cropping_flag) {
        frame_crop_left_offset = ReadExponentialGolombCode(ctx);
        frame_crop_right_offset = ReadExponentialGolombCode(ctx);
        frame_crop_top_offset = ReadExponentialGolombCode(ctx);
        frame_crop_bottom_offset = ReadExponentialGolombCode(ctx);
    }
    var vui_parameters_present_flag = ReadBit(ctx);
    if(vui_parameters_present_flag) {
    	var aspect_ratio_info_present_flag = ReadBit(ctx);
    	if(aspect_ratio_info_present_flag) {
    		var aspect_ratio_idc = ReadBits(ctx,8);
    		if(aspect_ratio_idc == 0xff) {
                var sar_width = ReadBits(ctx,8);
                var sar_height = ReadBits(ctx,8);
    		}
    	}
        var overscan_info_present_flag = ReadBit(ctx);
        if (overscan_info_present_flag) {
            var overscan_appropriate_flag = ReadBit(ctx);
        }
        var video_signal_type_present_flag = ReadBit(ctx);
        if(video_signal_type_present_flag) {
	        var video_format = ReadBits(ctx,3);
	        var video_full_range_flag = ReadBit(ctx);
	        var colour_description_present_flag = ReadBit(ctx);
	        if (colour_description_present_flag) {
	            var colour_primaries = ReadBit(ctx, 8);
	            var transfer_characteristics = ReadBit(ctx, 8);
	            var matrix_coefficients = ReadBit(ctx, 8);
	        }
        }
        var timing_info_present_flag = ReadBit(ctx);
    }
        
    var width = ((pic_width_in_mbs_minus1 +1)*16) - frame_crop_bottom_offset*2 - frame_crop_top_offset*2;
    var height = ((2 - frame_mbs_only_flag)* (pic_height_in_map_units_minus1 +1) * 16) - (frame_crop_right_offset * 2) - (frame_crop_left_offset * 2);

    return {
    	width: Math.floor((width+7)/8)*8,
    	height: height,
    }
}

exports.extractMeta = function(query,data) {
	var context = query.previous || {};
	var meta = {
		previous: {},
	};
	var units = ParseNalUnits(data,0,data.length);
	var unconfirmedUnit = context.unconfirmedUnit || null;
	if(unconfirmedUnit) {
		if(units.length>0) {
			var firstUnit = units[0];
			if(firstUnit.o==3 || (firstUnit.o==4 && firstUnit.data[0]==0)) {
				units.unshift(unconfirmedUnit);
			} else {
				var data2 = new Uint8Array(unconfirmedUnit.s + firstUnit.s);
				data2.set(unconfirmedUnit.data.subarray(unconfirmedUnit.o,unconfirmedUnit.o+unconfirmedUnit.s),0);
				data2.set(firstUnit.data.subarray(firstUnit.o,firstUnit.o+firstUnit.s),unconfirmedUnit.s);
				firstUnit = {
					o: 0,
					s: unconfirmedUnit.s + firstUnit.s,
					data: data2,
				}
			}
		} else
			units.push(unconfirmedUnit);
	}
	if(context.confirmedUnusedUnits)
		units = [].concat(context.confirmedUnusedUnits,units);

	var unitsLimit = query.flush ? units.length : units.length - 1;
	
	if(query.sps || query.pps || query.width || query.height) {
		for(var i=0;i<unitsLimit;i++) {
			var unit = units[i];
			var type = unit.data[unit.o] & 0x1f;
			if( type == 0x7 ) {
				if( query.sps && !meta.sps) {
					meta.sps = new ArrayBuffer(unit.s);
					var sps = new Uint8Array(meta.sps);
					sps.set(unit.data.subarray(unit.o,unit.o+unit.s));
				}
				if( (query.width && !meta.width) ||
					(query.height && !meta.height) ) {
					var spsMeta = ParseSps(unit.data,unit.o+1,unit.s)
					meta.width = spsMeta.width;
					meta.height = spsMeta.height;
				}			
			} else if(type == 0x8 && query.pps && !meta.pps) {
				meta.pps = new ArrayBuffer(unit.s);
				var pps = new Uint8Array(meta.pps);
				pps.set(unit.data.subarray(unit.o,unit.o+unit.s));
			}
		}
	}
	
	var gotUnitStart = context.gotUnitStart || false;
	var keyFrame = context.keyFrame || false;
	var frameUnit = context.frameUnit || false;
	var avccData = context.avccData || [];
	var avccSize = context.avccSize || 0;

	var frameReady = false;

	for(var i=0;i<unitsLimit;i++) {
		var unit = units[i];
		if(unit.s==0)
			continue;
		var type = unit.data[unit.o] & 0x1f;
		if(type==0x9) {
			if(gotUnitStart) {
				frameReady = true;
				meta.previous.confirmedUnusedUnits = units.slice(i,unitsLimit);
				break;
			} else
				gotUnitStart = true;
		} else if(type==0x5) {
			if(unit.data[unit.o+1]!=0)
				keyFrame = true;
			frameUnit = true;
		} else if(type==0x1)
			frameUnit = true;
		
		if(gotUnitStart) {
			var lengthData = new Uint8Array(4); 
			bits.WriteInt32(lengthData,0,unit.s);
			avccData.push(lengthData);
			avccData.push(unit.data.subarray(unit.o,unit.o+unit.s));
			avccSize += unit.s + 4;
		}
	}
	if((frameReady || query.flush) && gotUnitStart && frameUnit) {
		meta.avccData = avccData;
		meta.frame = {
			size: avccSize,
			key: keyFrame, 			
		}
	} else {
		meta.previous.gotUnitStart = gotUnitStart;
		meta.previous.avccData = avccData;
		meta.previous.avccSize = avccSize;
		meta.previous.keyFrame = keyFrame;
		meta.previous.frameUnit = frameUnit;
	}
	if(!query.flush) {
		meta.previous.unconfirmedUnit = units[units.length-1];
	}
	return meta;
}
