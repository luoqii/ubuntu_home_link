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
const simplePrefs = require("sdk/simple-prefs");

var extensions = {};

simplePrefs.on("extend",function() {
	var extend = simplePrefs.prefs['extend'];
	if(extend=="")
		return;
	else if(extend[0]=="$")
		return;
	else {
		var extension = extensions[extend]; 
		if(extension && extension.unregister) {
			try {
				extension.unregister();
			} catch($_) {}
			delete extensions[extend];
		}
		console.info("*************** trying to import",extend)
		Cu.import(extend);
		try {
			var extension = vdhExtend({
				extender: exports,
				hits: require("./hits"),
				actions: require("./actions"),
				Class: require('sdk/core/heritage').Class,
				merge: require('sdk/util/object').merge,
			});
			extensions[extend] = extension;
		} catch(e) {
			console.warn("Cannot install extension",e);
		}
		simplePrefs.prefs['extend'] = "$ready";
	}
});

simplePrefs.prefs['extend'] = "$ready";

require("sdk/system/unload").when(function() {
	for(var id in extensions) {
		var extension = extensions[id];
		if(extension.unregister)
			try {
				extension.unregister();
			} catch($_) {}
	}
	simplePrefs.prefs['extend'] = ""; 
}); 
