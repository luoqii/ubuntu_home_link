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
const self = require("sdk/self");
const Worker = require('sdk/content/worker').Worker;
const windowUtils = require("sdk/window/utils");
const simplePrefs = require('sdk/simple-prefs');
const timers = require("sdk/timers");
const privateBrowsing = require("sdk/private-browsing");
const _ = require("sdk/l10n").get;
const pageMod = require("sdk/page-mod");
const $viewCore = require("sdk/view/core");
const viewFor = $viewCore.viewFor; 
Cu.import("resource://gre/modules/Services.jsm");
var e10sEnabled = Services.appinfo.browserTabsRemoteAutostart;

const hits = require("./hits");

function CheckGalleries(window) {
	var worker = new Worker({
		window: window,
	    contentScriptFile: self.data.url("gallery-content.js"),
		contentScriptOptions: {
			minAppletSize: simplePrefs.prefs['scrap.min-applet-size'],
		},
	    onAttach: function(event) {
	    	timers.setTimeout(function() {
		    	worker.port.emit("detect",{
		    		extensions: simplePrefs.prefs['medialink-extensions'],
		    		maxHits: simplePrefs.prefs['medialink-max-hits'],
		    		minFilesPerGroup: simplePrefs.prefs['medialink-min-files-per-group'],
		    		minImgSize: simplePrefs.prefs['medialink-min-img-size'],
		    		scanImages: simplePrefs.prefs['medialink-scan-images'],
		    		scrapSelector: simplePrefs.prefs['scrap.applet-selector'],
		    	});	    		    		
	    	});
	    }
	});
    worker.port.on("detected",function(message) {
    	var hitDataArray = [];
    	
    	Cu.import("resource://gre/modules/NetUtil.jsm");

    	for(var i in message.groups) {
    		var group = message.groups[i];
    		var title="?";
    		var m = /^https?:\/\/([^\/:]+)/.exec(group.baseUrl);
    		switch(group.type) {
    		case "image": 
    			title = _("gallery");
        		if(m)
    				title = _("gallery-from-domain",m[1]);
    			break;
    		case "link":
    			title = _("gallery-links");
        		if(m)
    				title = _("gallery-links-from-domain",m[1]);
    			break;
    		case "scrap":
    			title = _("scrap.screen-capture");
        		if(m)
    				title = _("scrap.screen-capture-from-domain",m[1]);
    			break;
    		}
    		var urls = [];
    		if(group.urls)
	    		group.urls.forEach(function(url) {
	    			urls.push(NetUtil.newURI(group.baseUrl).resolve(url));
	    		});
    		var hitData = {
				id: "gallery:"+i,
				title: title,
		    	pageUrl: group.baseUrl,
    			topUrl: group.baseUrl,
    	    	isPrivate: privateBrowsing.isPrivate(worker),
    	    	_trackMouse: true,
    	    	_gallery: {
    	    		selectorAttr: group.selectorAttr,
    	    		baseUrl: group.baseUrl,
    	    		type: group.type,
    	    	}
			}
	    	if(worker.tab) {
				var tabView = viewFor(worker.tab);
				try {
					if(!e10sEnabled)
						hitData.thumbnail = worker.tab.getThumbnail();
				} catch($_) {}
		    	hitData.topUrl = worker.tab.url;
	    	}
    		if(group.extensions) {
    			if(group.type=="image" && !simplePrefs.prefs['medialink-scan-images'])
    				continue;
       			if(group.type=="link" && !simplePrefs.prefs['medialink-scan-links'])
       				continue;
    			hitData.urls = urls;
	    		var extensions = Object.keys(group.extensions);
	    		extensions.sort(function(a,b) {
	    			return group.extensions[a]-group.extensions[b];
	    		});
	    		var extStrs = [];
	    		extensions.forEach(function(extension) {
	    			var str = _('number-type',""+group.extensions[extension],extension.toUpperCase());
	    			extStrs.push(str);
	    		});
	    		hitData.description = _('gallery-files-types',extStrs.join(", "));
    		} else if(group.type=="scrap") {
    			if(!simplePrefs.prefs['scrap.enabled'])
    				continue;
    			hitData.description = group.size;
    			hitData.scrapable = true;
    			hitData.selector = group.selector;
    			hitData._priorityClass = -1; 
    		}
    		hitDataArray.push(hitData);
    	}
    	hits.newData(hitDataArray);
    });
}

exports.checkCurrentPage = function() {
	var currentWindow = windowUtils.getMostRecentBrowserWindow();
	if(currentWindow.content)
		CheckGalleries(currentWindow.content);
}

var pageModSelect = null;

const maskStyle = ".vdh-mask { position: absolute; display: none; background-color: rgba(255,0,0,0.5); z-index: 2147483647; }";

exports.select = function(specs) {

	if(pageModSelect) { 
		pageModSelect.destroy();
		pageModSelect = null;
	}
	
	if(specs.select) {
		pageModSelect = pageMod.PageMod({
			include: specs.gallery.baseUrl,
			attachTo: ["existing","top","frame"],
			contentStyle: [
			    maskStyle,
			    ".vdh-mask."+specs.gallery.selectorAttr+" { display: block !important; }",
			],
		});
	}
}

exports.unselect = function() {
	if(pageModSelect) { 
		pageModSelect.destroy();
		pageModSelect = null;
	}
}

var pageModAuto = null;

function StartStop() {
	var autoDetect = (simplePrefs.prefs['medialink-auto-detect'] && (simplePrefs.prefs['medialink-scan-images'] || simplePrefs.prefs['medialink-scan-links'])) 
		|| (simplePrefs.prefs['scrap.auto-detect'] && simplePrefs.prefs['scrap.enabled']);
	
	if(autoDetect && !pageModAuto)
		pageModAuto = pageMod.PageMod({
			include: /^https?.*/,
			attachTo: ["top"],
			contentScriptWhen: "end",
			onAttach: function(worker) {
				if(worker.tab && worker.tab.window)
					CheckGalleries(viewFor(worker.tab.window).content);
			},
		});
	else if(!autoDetect && pageModAuto)
		pageModAuto.destroy();

}
simplePrefs.on("medialink-auto-detect",function() {
	StartStop();
});
simplePrefs.on("scrap.auto-detect",function() {
	StartStop();
});
simplePrefs.on("medialink-scan-images",function() {
	StartStop();
});
simplePrefs.on("medialink-scan-links",function() {
	StartStop();
});
simplePrefs.on("scrap.enabled",function() {
	StartStop();
});
StartStop();

