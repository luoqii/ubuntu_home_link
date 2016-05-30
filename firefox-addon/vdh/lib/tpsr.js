/* Copyright (C) 2006-2016 Michel Gutierrez <mig@downloadhelper.net>
 * All Rights Reserved
 * 
 * If you are interested in methods used in this project, follow the
 * open source project at https://github.com/mi-g/fang
 */

const self = require("sdk/self");
const pageMod = require("sdk/page-mod");
const timers = require("sdk/timers");
const tabs = require("sdk/tabs");
const tabsUtils = require("sdk/tabs/utils");
const simplePrefs = require("sdk/simple-prefs");
const modelFor = require("sdk/model/core").modelFor;

const panels = require("./panels");

const TPSR_SEARCH_PATTERN = new RegExp("^https?://([^/]*\.)?\x74\x77\x69\x74\x74\x65\x72(\.co)?\.([^\./]+)/search\\?.*f=tweets.*");
const TPSR_CARDFRAME_PATTERN = new RegExp("^https?://www.periscope.tv/w/.*/card$");
const TPSR_CARDFRAME2_PATTERN = new RegExp("^https?://([^/]*\.)?\x74\x77\x69\x74\x74\x65\x72(\.co)?\.([^\./]+)/i/cards/tfw/.*");
const TPSR_LIVE_PATTERN = new RegExp("^https?://www.periscope.tv/w/(?!.*\/card$).*$");

var running = false;
var searchPageMod = null;
var cardFramePageMod = null;
var cardFrame2PageMod = null;
var searchTab = null;

var tpsrTabs = {};
var backLogQueue = [];
var processingCount = 0;

exports.isRunning = function() {
	return running;
}

exports.action = function(action) {
	switch(action) {
	case "start":
		exports.start();
		break;
	case "stop":
		exports.stop();
		break;
	}
}

function Start(search) {
	if(simplePrefs.prefs['tpsr.state'] != "stopped")
		return;
	simplePrefs.prefs['tpsr.state'] = "started";
	tpsrTabs = {};
	backLogQueue = [];
	processingCount = 0;

	searchPageMod = pageMod.PageMod({
		include: TPSR_SEARCH_PATTERN,
		contentScriptFile: [
		    self.data.url("lib/jquery.min.js"),
		    self.data.url("relay-content.js"),
		    self.data.url("tpsr-content.js"),
		],
		contentScriptWhen: 'end',
		attachTo: "top",
		onAttach: function(worker) {
		    worker.port.on("vdh-message",function(message) {
		    	switch(message.type) {
		    	case 'detected-links':
		    		NewLinks(message.links);
		    		break;
		    	}
		    });
		},
	});
	cardFramePageMod = pageMod.PageMod({
		include: TPSR_CARDFRAME_PATTERN,
		contentScriptFile: [
		    self.data.url("lib/jquery.min.js"),
		    self.data.url("relay-content.js"),
		    self.data.url("tpsr-cardframe-content.js"),
		],
		contentScriptWhen: 'end',
		attachTo: "frame",
		onAttach: function(worker) {
		    worker.port.on("vdh-message",function(message) {
		    	switch(message.type) {
		    	case 'detected-links':
		    		NewLinks(message.links);
		    		break;
		    	}
		    });
		},
	});
	cardFrame2PageMod = pageMod.PageMod({
		include: TPSR_CARDFRAME2_PATTERN,
		contentScriptFile: [
		    self.data.url("lib/jquery.min.js"),
		    self.data.url("relay-content.js"),
		    self.data.url("tpsr-cardframe2-content.js"),
		],
		contentScriptWhen: 'end',
		attachTo: "frame",
		onAttach: function(worker) {
		    worker.port.on("vdh-message",function(message) {
		    	switch(message.type) {
		    	case 'detected-links':
		    		NewLinks(message.links);
		    		break;
		    	}
		    });
		},
	});
	running = true;
	tabs.open({
		url: "https://twitter.com/search?f=tweets&q="+encodeURIComponent(/^(.*?)\s*$/.exec("live #periscope "+search)[1])+"&src=typd",
		inBackground: true,
		onOpen: function(tab) {
			searchTab = tab;
		},
		onClose: function(tab) {
			exports.stop();
		},
	});
}

exports.start = function() {
	if(simplePrefs.prefs['tpsr.state'] != "stopped")
		return;
	panels.togglePanel('tpsr',{
		contentURL: "tpsrPanel.html",
		top: 10,
		closeTimeout: 0,
		jsFiles: [
		    "tpsrPanel.js",
		],
		onShow: function(panel) {
			var converter = require("./converter")
			converter.check(function() {
				panel.port.emit("contentMessage",{
					type: "set",
					name: "converter",
					value: converter.config(),
				});					
			});
		},
		onMessage: function(message,panel) {
			switch(message.type) {
			case "start":
				panel.hide();
				Start(message.search);
				break;
			case "goto":
				panel.hide();
				switch(message.where) {
				case 'converter':
					require("sdk/tabs").open({
						url: "http://www.downloadhelper.net/install-converter3.php",
					});
					break;
				}
				break;
			}
		},
	});
}

exports.stop = function() {
	simplePrefs.prefs['tpsr.state'] = "stopped";
	running = false;
	if(searchPageMod) {
		searchPageMod.destroy();
		searchPageMod = null;
	}
	if(cardFramePageMod) {
		cardFramePageMod.destroy();
		cardFramePageMod = null;
	}
	if(cardFrame2PageMod) {
		cardFrame2PageMod.destroy();
		cardFrame2PageMod = null;
	}
	if(searchTab) {
		searchTab.close();
		searchTab = null;
	}
	for(var id in tpsrTabs) {
		var tab = modelFor(tabsUtils.getTabForId(id));
		if(tab)
			tab.close();
		else
			delete tpsrTabs[id]; 
	}
}

exports.hit = function(hitData,id) {
	var tab = null;
	for(var id in tpsrTabs) {
		var tab1 = modelFor(tabsUtils.getTabForId(id));
		if(tab1.url==hitData.topUrl) {
			tab = tab1;
			break;
		}
	}
	var hitExtend = {};
	if(tab) {
		hitExtend.autoExec = "quickdownload";
		hitExtend._tpsr = true;
		var convertConfigId = simplePrefs.prefs['tpsr.convert'];  
		if(convertConfigId) {
			var converter = require("./converter");
			var convertId = simplePrefs.prefs['tpsr.convert'];
			var config = converter.config().configs[convertConfigId];
			if(config) {
				hitExtend._convert = config;
				hitExtend.extension = config.ext;
			}
		}
		CloseTab(tab);
	}
	return hitExtend;
}

exports.recordingFinished = function(status,hitData) {
	if(!hitData || !hitData._tpsr)
		return;
	processingCount --;
	PollQueue();
}

function PollQueue() {
	if(simplePrefs.prefs['tpsr.state'] != "started")
		return;
	while(processingCount<simplePrefs.prefs['tpsr.concurrent-captures'] && backLogQueue.length>0) {
		var url = backLogQueue.shift();
		ProcessURL(url);
	}
	while(backLogQueue.length>100)
		backLogQueue.pop();
}

function NewLinks(links) {
	backLogQueue = links.concat(backLogQueue);
	PollQueue();
}

function CloseTab(tab) {
	var retries = 0;

	function DoCloseTab() {
		try {
			tab.close();
			if(retries>0)
				console.warn("TPSR tab closed after",retries,"attempts");
		} catch(e) {
			if(retries++<10)
				timers.setTimeout(DoCloseTab,250);
			else
				console.warn("Unable to close TPSR tab");
		}
	}
	DoCloseTab();
}

function ProcessURL(url) {
	processingCount++;
	var timer = null;
	var openTimer = timers.setTimeout(function() {
		console.warn("!!!!! tab did not open");
		for(var tabId in tabs) {
			var tab = tabs[tabId];
			if(tab && tab.url==url)
				CloseTab(tab);
		}
		processingCount--;
		PollQueue();
	},100000);
	tabs.open({
		url: url,
		inBackground: true,
		onOpen: function(tab) {
			if(openTimer) {
				timers.clearTimeout(openTimer);
				openTimer = null;
			}
			tpsrTabs[tab.id] = true;
			timer = timers.setTimeout(function() {
				processingCount--;			
				timer = null;
				CloseTab(tab);
			},simplePrefs.prefs['tpsr.start-timeout']*1000)
		},
		onClose: function(tab) {
			if(openTimer) {
				timers.clearTimeout(openTimer);
				openTimer = null;
			}
			delete tpsrTabs[tab.id];
			if(timer) {
				timers.clearTimeout(timer);
				timer = null;
			}
			PollQueue();
		},
	});
}

require("sdk/system/unload").when(function() {
	if(simplePrefs.prefs['tpsr.state'] == "started")
		exports.stop();
});
