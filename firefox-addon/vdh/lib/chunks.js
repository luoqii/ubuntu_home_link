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
const CC = $chrome.CC;

const merge = require('sdk/util/object').merge;
const timers = require("sdk/timers");
const simplePrefs = require("sdk/simple-prefs");
const _ = require("sdk/l10n").get;

const hits = require("./hits");
const utils = require("./utils");
const log = require("./log");
const m3u8 = require("./m3u8");
const hls = require("./hls");
const dash = require("./dash");
const f4f = require("./f4f");
const amf = require("./amf");

const JSON_MASTER_PATTERN = new RegExp("^https?://.*/master\\.json");
const DASH_XML_CT_PATTERN = new RegExp("dash.*mpd");
const M3U8_PATTERN = new RegExp("^https?://.*\\.m3u8(?:\\?|$)");
const M3U8_LINE_PATTERN = new RegExp("^\\s*#");
const JSON_HLS_PS_PATTERN = new RegExp("^https?://api\\.periscope\\.tv/api/v2/getAccessPublic");
const EMPTY_LINE_PATTERN = new RegExp("^\\s*$");

const F4F_PATTERN = new RegExp("^https?://.*\\.f4m(?:\\?|$)");
const F4F_PATTERN_FRAG = new RegExp("^https?://.*Seg1\\-Frag([0-9]+)(\\?.*)?$");

const BinaryInputStream = CC('@mozilla.org/binaryinputstream;1', 'nsIBinaryInputStream', 'setInputStream');
const BinaryOutputStream = CC('@mozilla.org/binaryoutputstream;1', 'nsIBinaryOutputStream', 'setOutputStream');
const StorageStream = CC('@mozilla.org/storagestream;1', 'nsIStorageStream', 'init');

exports.networkHook = function(channel,meta) {
	if(!simplePrefs.prefs["chunks.enabled"])
		return;
	var probe = null;
	if(simplePrefs.prefs["dash.enabled"]) {
		if(JSON_MASTER_PATTERN.test(channel.name))
			probe = new Dash("json");
		else if(meta.contentType && DASH_XML_CT_PATTERN.test(meta.contentType.toLowerCase()))
			probe = new Dash("xml");		
	}
	if(simplePrefs.prefs["hls.enabled"]) {
		if(M3U8_PATTERN.test(channel.name))
			probe = new Hls(channel.name);
		else if(JSON_HLS_PS_PATTERN.test(channel.name))
			probe = new Hls(channel.name,"json");		
		else if(meta.contentType && meta.contentType.toLowerCase().indexOf("mpegurl")>=0)
			probe = new Hls(channel.name);
	}
	if(!probe && simplePrefs.prefs["f4f.enabled"]) {
		probe = F4f.getProbe(channel);
	}
	if(probe) {
		var tracChannel = channel.QueryInterface(Ci.nsITraceableChannel);
		probe.originalListener = tracChannel.setNewListener(probe);
		return probe;
	}
}

function Probe() {
}

Probe.prototype = {
	init: function(type) {
		this.type = type;
		this.receivedChunks = [];
	},
	handleHit: function(hitData) {
		this.hitData = hitData;
		this.checkReady();
	},
	onDataAvailable: function(aRequest, aContext, aInputStream, aOffset, aCount) {
		var iStream = new BinaryInputStream(aInputStream);
		var sStream = new StorageStream(8192, aCount, null);
		var oStream = new BinaryOutputStream(sStream.getOutputStream(0));
		var data = iStream.readBytes(aCount);
		this.receivedChunks.push(data);
		oStream.writeBytes(data, aCount);
		this.originalListener.onDataAvailable(aRequest, aContext, sStream.newInputStream(0), aOffset, aCount);
	},
	onStartRequest: function(aRequest, aContext) {
		this.originalListener.onStartRequest(aRequest, aContext);
	},
	onStopRequest: function(aRequest, aContext, aStatusCode) {
		var body = this.receivedChunks.join("");
		delete this.receivedChunks;
		try {
			this.handleManifest(body);
			this.checkReady();
		} catch(e) {
			console.error("chunks manifest error",e.message);
		}
		this.originalListener.onStopRequest(aRequest, aContext, aStatusCode);

	},
	checkReady: function() {},
	handleManifest: function() {},
	handle: function() {},
};

function Dash(format) {
	this.format = format;
	this.init("dash");
}

Dash.prototype = new Probe();

Dash.prototype.handleManifest = function(body) {
	try {
		if(this.format=="json") {
			var mpd = JSON.parse(body);
			if(mpd && Array.isArray(mpd.video) && mpd.video.length>0 && Array.isArray(mpd.video[0].segments) && mpd.video[0].segments.length>0)
				this.mpd = mpd;			
		} else if(this.format=="xml") {
			/*
			var parser = Cc["@mozilla.org/xmlextras/domparser;1"].createInstance(Ci.nsIDOMParser);
			var doc = parser.parseFromString(body, "application/xml");
			*/
		}
	} catch(e) { 
		console.error("Error parsing DASH manifest",e.message || e); 
	}
}
Dash.prototype.checkReady = function() {
	if(this.hitData && this.mpd)
		this.handle();
}
Dash.prototype.handle = function() {
	var hash = utils.md5(this.hitData.url);
	var self = this;
	this.mpd.video.forEach(function(video,index) {
		var hitData = merge({},self.hitData,{
			id: "dash:"+hash+"-"+index,
            "extension": "mp4",
			_mpd: video,
			length: null,
			chunked: "dash",
			descrPrefix: _("dash-streaming"),
		});
		hitData._mpd.commonBaseUrl = self.mpd.base_url; 
		if(video.width && video.height)
			hitData.size = video.width + "x" + video.height;
		if(video.duration)
			hitData.duration = Math.round(video.duration);
		hits.newData(hitData);
	});
}

function Hls(url,masterFormat) {
	this.init("hls");
	this.masterFormat = masterFormat || "m3u8"; 
	this.mediaUrl = url;
}

Hls.prototype = new Probe();

Hls.prototype.handleManifest = function(body) {
	var manifest = null;
	if(this.masterFormat=="m3u8")
		manifest = m3u8.get(body,this.mediaUrl);
	else if(this.masterFormat=="json")
		manifest = m3u8.getPsJson(body,this.mediaUrl);
	if(manifest) {
		if(manifest.isMaster())
			this.master = manifest;
		else if(manifest.isMedia())
			this.media = manifest;
	}
}
Hls.prototype.checkReady = function() {
	if(this.hitData && (this.master || this.media))
		this.handle();
}
Hls.prototype.handle = function() {
	if(this.master)
		hls.handleMaster(this.master,this.hitData);
	else if(this.media)
		hls.handleMedia(this.media,this.hitData,this.mediaUrl);
}

function F4f(url) {
	this.init("f4f");
	Cu.import("resource://gre/modules/NetUtil.jsm");
	if(simplePrefs.prefs['f4f.frag-index']) {
		var url0 = NetUtil.newURI(url);
		var rootUrl = /^(.*?)([^\/]*)$/.exec(url0.prePath + url0.path)[1];
		F4f.waitingForFrag[rootUrl] = this;
	}
}

F4f.getProbe = function(channel) {
	var probe = null;
	if(F4F_PATTERN.test(channel.name)) {
		probe = new F4f(channel.name);
	} else if(simplePrefs.prefs['f4f.frag-index']) {
		var m = F4F_PATTERN_FRAG.exec(channel.name);
		if(m) {
			Cu.import("resource://gre/modules/NetUtil.jsm");
			var url0 = NetUtil.newURI(channel.name);
			var rootUrl = /^(.*?)([^\/]*)$/.exec(url0.prePath + url0.path)[1];
			var probe0 = F4f.waitingForFrag[rootUrl];
			if(probe0) {
				delete F4f.waitingForFrag[rootUrl];
				probe0.startFrag = parseInt(m[1]);
				probe0.postFrag = m[2];
				probe0.checkReady();
			}
		}
	}	
	return probe;
}

F4f.waitingForFrag = {};

F4f.prototype = new Probe();

F4f.prototype.checkReady = function() {
	if(this.hitData && this.medias && (this.startFrag || !simplePrefs.prefs['f4f.frag-index']))
		this.handle();
}

F4f.prototype.handleManifest = function(body) {
	var parser = Cc["@mozilla.org/xmlextras/domparser;1"].createInstance(Ci.nsIDOMParser);
	var doc = parser.parseFromString(body, "application/xml");
	var durationElement = doc.querySelector("duration");
	if(durationElement)
		this.duration = parseInt(durationElement.firstChild.nodeValue);
	var bis = doc.querySelectorAll("bootstrapInfo");
	this.medias = {};
	for(var i=0;i<bis.length;i++) {
		var bi = bis.item(i);
		var id = bi.getAttribute("id");
		var data = (bi.firstChild && utils.toByteArray(bi.firstChild.nodeValue)) || null;
		this.medias[id] = {
			bootstrap: data,
		}
	}
	var mes = doc.querySelectorAll("media");
	for(var i=0;i<mes.length;i++) {
		var m = mes.item(i);
		var mid = m.getAttribute("bootstrapInfoId");
		var media = this.medias[mid];
		if(media) {
			media.bitrate = parseInt(m.getAttribute("bitrate"))*1000;
			media.urlHint = m.getAttribute("url");
			var metaElement = m.querySelector("metadata");
			if(metaElement) {
				var metaBytes = (metaElement.firstChild && utils.toByteArray(metaElement.firstChild.nodeValue)) || null;
				if(metaBytes) {
					var metaVars = amf.decode(metaBytes);
					if(metaVars && metaVars.length>=2 && metaVars[0]=="onMetaData")
						media.meta = metaVars[1];
				}
			}
		}
	}
}

F4f.prototype.handle = function() {
	for(var id in this.medias) {
		var media = this.medias[id];
		var hash = utils.md5(this.hitData.url+id);
		var hitData = merge({},this.hitData,{
			id: "f4f:"+hash,
            "extension": "flv",
			bitrate: media.bitrate,
			_media: media,
			length: null,
			chunked: "f4f",
			descrPrefix: _("f4f-streaming"),
			startFrag: this.startFrag,
			postFrag: this.postFrag || "",
		});
		if(this.duration)
			hitData.duration = this.duration;
		if(media.meta) {
			var meta = media.meta;
			if(meta.duration)
				hitData.duration = Math.round(meta.duration);
			if(meta.width && meta.height)
				hitData.size = meta.width + "x" + meta.height;
			if(meta.filesize)
				hitData.length = meta.filesize;
			if(meta.framerate)
				hitData.fps = meta.framerate;
		}
		hits.newData(hitData);
	}
}

exports.download = function(action,specs,successFn,errorFn,progressFn) {
	specs.ignoreSpecs = true;
	var chunkSet = null;
	switch(action.hit.data.chunked) {
	case "hls":
		chunkSet = hls.getChunkSet(action.hit.data);
		break;
	case "dash":
		chunkSet = new dash.DashChunkset();
		chunkSet.init(action.hit.data);
		break;
	case "f4f":
		chunkSet = new f4f.F4fChunkset();
		chunkSet.init(action.hit.data);
		break;
	}
	if(!chunkSet) {
		log.error("Requested download of chunked stream, but no chunkset found");
		action.cleanup();
		action.hit.setCurrentAction(null);
		action.notifyRunning(false);
		return;
	}
	chunkSet.download(action,specs,successFn,errorFn,progressFn);
}
