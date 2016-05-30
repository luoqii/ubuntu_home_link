/* Copyright (C) 2006-2016 Michel Gutierrez <mig@downloadhelper.net>
 * All Rights Reserved
 * 
 * If you are interested in methods used in this project, follow the
 * open source project at https://github.com/mi-g/fang
 */


const tabs = require("sdk/tabs");
const windows = require("sdk/windows").browserWindows;

exports.show = function() {
	
	var urlRE = new RegExp("^https?://([^/]+)(/[^\\?]+)");
	var dhDomain = new RegExp("\\bdownloadhelper.net\\b");
	
	/* @+firefox */
	for(var tabId in tabs) {
		var tab = tabs[tabId];
		var m = urlRE.exec(tab.url);
		if(m) {
			if(dhDomain.test(m[1]) && m[2].indexOf("/addon-sites/")==0) {
				tab.activate();
				if(tab.window != windows.activeWindow)
					tab.window.activate();
				return;
			}
		}
	}
	tabs.open({
		url: "http://www.downloadhelper.net/addon-sites/",
	});
	/* @- */

	/* @+chrome 
	chrome.tabs.query({
		},function(tabs) {
			for(var tabId=0; tabId<tabs.length; tabId++) {
				var tab = tabs[tabId];
				var m = urlRE.exec(tab.url);
				if(m) {
					if(dhDomain.test(m[1]) && m[2].indexOf("/addon-sites/")==0) {
						chrome.windows.update(tab.windowId,{ focused: true },function() {
							chrome.tabs.highlight({
								windowId: tab.windowId,
								tabs: [tabId]
							});
						});
						return;
					}
				}
			}
			chrome.tabs.create({
				url: "http://www.downloadhelper.net/addon-sites/",
				active: true,
		});
	});
	@- */		
}
