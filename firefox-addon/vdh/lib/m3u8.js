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

const merge = require('sdk/util/object').merge;

const EXT_PATTERN = new RegExp("^#(EXT[^\\s:]+)(?::(.*))");
const ATTR_PATTERN = new RegExp("^\\s*([A-Z0-9\\-]+)=\"?(.*?)\"?\\s*$");
const STRING_PATTERN = new RegExp("^\\s*\"(.*)\"\\s*$");

function M3U8() {
}

M3U8.prototype = {
	init: function() {
		this.tags = {}
		this.segments = [];
		this.valid = false;		
	},
	parse: function(text,baseUrl) {
		var lines = text.split(/[\r\n]+/);
		if(lines.length==0)
			return;
		if(lines[0].trim()!="#EXTM3U")
			return;
		this.master = true;
		var segments = [];
		var tags = {};
		Cu.import("resource://gre/modules/NetUtil.jsm");
		var uri = NetUtil.newURI(baseUrl);
		for(var i=1;i<lines.length;i++) {
			var line = lines[i].trim();
			if(line=="")
				continue;
			if(line[0]=="#") {
				if(line.indexOf("#EXT")!=0)
					continue;
				var m = EXT_PATTERN.exec(line);
				if(!m)
					continue;
				if(m[1]=="EXTINF")
					this.master = false;
				tags[m[1]] = m[2];
			} else
				segments.push({
					url: uri.resolve(line),
					tags: merge({},tags),
				});
		}
		if(segments.length==0)
			return;
		for(var tag in segments[0].tags) {
			var value0 = segments[0].tags[tag];
			var common = true;
			for(var i = 1;i<segments.length;i++) {
				var segment = segments[i];
				if(segment.tags[tag]!==value0) {
					common = false;
					break;
				}
			}
			if(common)
				this.tags[tag] = this.parseAttrs(value0);
		}
		for(var i = 0;i<segments.length;i++) {
			var segment = segments[i];
			var segment0 = {
				url: segment.url,
				tags: {},
			}
			for(var tag in segment.tags)
				if(typeof this.tags[tag]=="undefined")
					segment0.tags[tag] = this.parseAttrs(segment.tags[tag]);
			this.segments.push(segment0);
		}
		this.valid = true;
	},
	
	parseAttrs: function(attrs) {
		var m = STRING_PATTERN.exec(attrs);
		if(m)
			return m[1];
		if(attrs.indexOf("=")<0)
			return attrs;
		var attrsMap = {};
		attrs.split(",").forEach(function(nameVal) {
			var m = ATTR_PATTERN.exec(nameVal);
			if(!m) return;
			attrsMap[m[1]] = m[2];
		});
		return attrsMap;
	},
	
	isMaster: function() {
		return this.valid && this.master;
	},

	isMedia: function() {
		return this.valid && !this.master;
	},
	
	walkThrough: function(callback) {
		var self = this;
		this.segments.forEach(function(segment,index) {
			callback(segment.url,merge({},self.tags,segment.tags),index);
		});
	}
}

function PsJsonM3U8() {}

PsJsonM3U8.prototype = new M3U8();

PsJsonM3U8.prototype.parse = function(text,baseUrl) {
	try {
		var https = baseUrl.indexOf("https") == 0;
		var manifest = JSON.parse(text);
		if(manifest.hls_url && !https)
			this.segments.push({
				url: manifest.hls_url,
				tags: {},
			});
		if(manifest.https_hls_url && https)
			this.segments.push({
				url: manifest.https_hls_url,
				tags: {},
			});
		if(this.segments.length>0) {
			this.valid = true;
			this.master = true;
		}
	} catch(e) {}
}

exports.get = function(text,baseUrl) {
	var m3u8 = new M3U8();
	m3u8.init();
	m3u8.parse(text,baseUrl);
	return (m3u8.valid && m3u8) || null;
}

exports.getPsJson = function(text,baseUrl) {
	var m3u8 = new PsJsonM3U8();
	m3u8.init();
	m3u8.parse(text,baseUrl);
	return (m3u8.valid && m3u8) || null;
}
