/* Copyright (C) 2006-2016 Michel Gutierrez <mig@downloadhelper.net>
 * All Rights Reserved
 * 
 * If you are interested in methods used in this project, follow the
 * open source project at https://github.com/mi-g/fang
 */


const self = require("sdk/self");
const tabs = require("sdk/tabs");
var simpleStorage = require("sdk/simple-storage");
const _ = require("sdk/l10n").get;
const simplePrefs = require("sdk/simple-prefs");
const merge = require('sdk/util/object').merge;

const panels = require("./panels");

function DomainsFromUrl(url) {
	var domains = [];
	var domain = /^https?:\/\/([^\/:]+)/.exec(url);
	if(domain) {
		var parts = domain[1].split(".");
		while(parts.length>1 && (parts[0]!="co" || parts.length>2)) {
			domains.push(parts.join("."));
			parts.shift();
		}
	}
	return domains;
}

function NameFromUrl(url) {
	const NAME_PATTERN = new RegExp("/([^/]+?)(?:\\.([a-z0-9]{1,5}))?(?:\\?|#|$)","i");
	var m = NAME_PATTERN.exec(url);
	if(m && m[1])
		return m[1];
	else
		return _("media");
		
}

exports.defineXPath = function(
/* @+chrome 
	tabId
@- */
) {
	var xpath = null;
	var worker = null;
	var mode = "page-content";
	if(!simpleStorage.storage.smartnames) {
		simpleStorage.storage.smartnames = {}
/* @+chrome 
		simpleStorage.storage.sync = "smartnames";
@- */
	}
/* @+firefox */
	function AttachWorker() {
		worker = tabs.activeTab.attach({
			contentScriptFile: self.data.url('smartnames-content.js'),
			onDetach: function() {
				worker = null;
			},
			onMessage: function (message) {
				switch(message.type) {
				case "current-xpath":
					if(message.xpath!=xpath) {
						xpath = message.xpath;
						panels.panelData('smartnames',['data','xpath'],xpath);
					}
					if(message.url) {
						var domains = DomainsFromUrl(message.url);
						panels.panelData('smartnames',['data','domains'],domains);
					}
					break;
				case "text": 
					panels.panelData('smartnames',['data','fullText'],message.text || '');
					panels.panelData('smartnames',['data','validXPath'],message.valid);
					break;
				}
			},
		});
		worker.port.emit("current-xpath",{});
	}
	AttachWorker();
/* @- */
	panels.togglePanel('smartnames',{
		contentURL: "smartnamesPanel.html",
		closeTimeout: 0,
		top: 10,
		jsFiles: [
		    "lib/jquery.min.js",
		    "lib/bootstrap/bootstrap.min.js",
		    "smartnamesPanel.js",
		],
		onShow: function(panel) {
/* @+firefox */
			if(!worker)
				AttachWorker();
/* @- */
/* @+chrome 
			chrome.tabs.executeScript(tabId,{
				file: "data/smartnames-content.js",
			},function() {
			    chrome.tabs.sendRequest(tabId, {
			    	type: "current-path",
			    }, function(message) {
					if(message.xpath!=xpath) {
						//xpath = message.xpath;
						panels.panelData('smartnames',['data','xpath'],message.xpath);
					}
					if(message.url) {
						var domains = DomainsFromUrl(message.url);
						panels.panelData('smartnames',['data','domains'],domains);
					}
			    });
			});
@- */
		},
		onHide: function() {
		},
		onMessage: function(message,panel) {
			switch(message.type) {
			case "check":
				if(message.mode=="header-url") {
					xpath = null;
					panels.panelData('smartnames',['data','fullText'],NameFromUrl(tabs.activeTab.url) || '');
				} else if(message.mode=="obfuscated") {
					xpath = null;
					panels.panelData('smartnames',['data','fullText'],exports.getObfuscated(tabs.activeTab.url) || '');
				} else {
					if(message.mode=="page-title")
						message.xpath = "/html/head/title"
					if(message.xpath!==xpath) {
						xpath = message.xpath;
/* @+firefox */
						if(!worker)
							AttachWorker();
						worker.port.emit("text",{
							xpath: xpath,
						});
/* @- */
/* @+chrome 
						chrome.tabs.executeScript(tabId,{
							file: "data/smartnames-content.js",
						},function() {
						    chrome.tabs.sendRequest(tabId, {
						    	type: "text",
						    	xpath: xpath,
						    }, function(message) {
								panels.panelData('smartnames',['data','fullText'],message.text || '');
								panels.panelData('smartnames',['data','validXPath'],message.valid);
						    });							    	
						});
@- */
					}					
				}
				break;
			case "set":
				if(message.mode=="page-title")
					message.xpath = "/html/head/title";
				simpleStorage.storage.smartnames[message.domain] = {
					mode: message.mode,
					xpath: message.xpath,
					regexp: message.regexp,
					delay: message.delay,
				}
/* @+chrome 
				simpleStorage.storage.sync = "smartnames";
@- */
				panel.hide();
				break;
			}
		},
	}); 
}

exports.specForUrl = function(url) {
	if(!simpleStorage.storage.smartnames) {
		simpleStorage.storage.smartnames = {}
/* @+chrome 
		simpleStorage.storage.sync = "smartnames";
@- */
	}
	var contentNeeded = {"page-title":1,"page-content":1};
	var domains = DomainsFromUrl(url);
	for(var i=0;i<domains.length;i++) {
		var domain = domains[i];
		var spec = simpleStorage.storage.smartnames[domain];
		if(spec) {
			spec.delay = isNaN(spec.delay) ? 0 : spec.delay;
			return {
				contentNeeded: (spec.mode in contentNeeded),
				spec: spec,
			}
		}
	}
	return {
		contentNeeded: (simplePrefs.prefs['smartnamer.defMode'] in contentNeeded),
		spec: {
			mode: simplePrefs.prefs['smartnamer.defMode'],
			xpath: "/html/head/title",
			regexp: ".*"
		},
	} 
}

exports.specsForUrl = function(url) {
	if(!simpleStorage.storage.smartnames) {
		simpleStorage.storage.smartnames = {}
/* @+chrome 
		simpleStorage.storage.sync = "smartnames";
@- */
	}
	var specs = [];
	DomainsFromUrl(url).forEach(function(domain) {
		var spec = simpleStorage.storage.smartnames[domain];
		if(spec)
			specs.push(spec);
	});
	return specs;
}

exports.getObfuscated = function(url) {
	var hash = require("./utils").md5(url); 
	return hash.substr(0,hash.length-2).replace(/[^a-zA-Z0-9]/g,'');
}

exports.getDomains = function() {
	var domains = [];
	for(var domain in simpleStorage.storage.smartnames)
		domains.push(domain);
	domains.sort();
	return domains;
}

exports.getAll = function() {
	var domains = [];
	for(var domain in simpleStorage.storage.smartnames) {
		var sn = simpleStorage.storage.smartnames[domain];
		var mode = sn.mode || "page-content";
		domains.push(merge({
			mode:mode,
			label: domain + " - " + _('smartnamer.'+mode)
		},sn,{ domain: domain }));
	}
	domains.sort(function(a,b) {
		return a.domain<b.domain?-1:1;
	});
	return domains;
}

exports.set = function(smartnames) {
	var newDomains = {};
	smartnames.forEach(function(smartname) {
		var domain = smartname.domain;
		newDomains[domain] = 1;
		var sn = merge({},smartname);
		delete sn.domain;
		delete sn.$$hashKey;
		delete sn.label;
		simpleStorage.storage.smartnames[domain] = sn;
	});
	for(var domain in simpleStorage.storage.smartnames)
		if(!newDomains[domain])
			delete simpleStorage.storage.smartnames[domain];
/* @+chrome 
	simpleStorage.storage.sync = "smartnames";
@- */
}

exports.cropDomains = function(domains) {
	var domainsMap = {};
	domains.forEach(function(domain) {
		domainsMap[domain] = 1;
	});
	for(var domain in simpleStorage.storage.smartnames)
		if(!domainsMap[domain])
			delete simpleStorage.storage.smartnames[domain];
/* @+chrome 
	simpleStorage.storage.sync = "smartnames";
@- */
}

exports.getTitle = function(url,window,callback) {
	var specForUrl = exports.specForUrl(url);
	if(specForUrl.contentNeeded) {
/* @+firefox */
		var worker = require('sdk/content/worker').Worker({
			window: window.content,
		    contentScriptFile: self.data.url("pagedata-content.js"),
		});
	    worker.port.on("pageurl",function(message) {
	    	worker.port.emit("get-title",{
	    		specs: [specForUrl.spec],
	    	});
	    });
	    worker.port.on("pagedata",function(message) {
	    	callback(message.title);
	    });
/* @- */
	} else {
    	if(specForUrl.spec.mode=="obfuscated")
    		callback(exports.getObfuscated(url));
    	else
    		callback(NameFromUrl(url));
	}
}

const FNAME_RE = new RegExp("[/\?<>\\:\*\|\":]|[\x00-\x1f\x80-\x9f]","g");
const SPACE_RE = new RegExp(" +","g");

exports.fixFileName = function(name) {
	name = name.replace(FNAME_RE,"");
	var title = name, extension = "";
	var m = /^(.*?)(?:\.([^\.]{1,5})?)$/.exec(name);
	if(m) {
		title = m[1];
		extension = m[2] || "";
	}
	var spaceRepls = { keep: ' ', remove: '', hyphen: '-', underscore: '_' }
	title = title.replace(SPACE_RE,spaceRepls[simplePrefs.prefs['smartnamer.fname.spaces']]);
	extension = extension.replace(SPACE_RE,spaceRepls[simplePrefs.prefs['smartnamer.fname.spaces']]);

	var maxLen = simplePrefs.prefs['smartnamer.fname.maxlen'];
	if(title.length+extension.length+1>maxLen) 
		title = title.substr(0,maxLen-extension.length-1);

	if(extension)
		return title + "." + extension;
	else
		return title;
}
