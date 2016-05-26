/* Copyright (C) 2006-2016 Michel Gutierrez <mig@downloadhelper.net>
 * All Rights Reserved
 * 
 * If you are interested in methods used in this project, follow the
 * open source project at https://github.com/mi-g/fang
 */


const { Cc, Ci, Cu } = require("chrome");
const _ = require("sdk/l10n").get;
const simplePrefs = require('sdk/simple-prefs');
const pageMod = require("sdk/page-mod");
const self = require("sdk/self");
const timers = require("sdk/timers");

const alerts = require("./alerts");

function Set(safe) {
	var cMgr = Cc["@mozilla.org/cookiemanager;1"].getService(Ci.nsICookieManager2);
	var cname="saf";
	if(safe) {
		var cookieDate=new Date().getTime()/1000+60*60*24*365*18;
		var cvalue="1";
     try {
			cMgr.add(".downloadhelper.net","/",cname,""+cvalue,false,true,cookieDate);
			cMgr.add(".vidohe.com","/",cname,""+cvalue,false,true,cookieDate);
		} catch(e) {
			cMgr.add(".downloadhelper.net","/",cname,""+cvalue,false,true,false,cookieDate);
			cMgr.add(".vidohe.com","/",cname,""+cvalue,false,true,false,cookieDate);
		}
	} else {
		try {
			cMgr.remove(".www.downloadhelper.net",cname,"/",false);
			cMgr.remove(".www.vidohe.com",cname,"/",false);
			cMgr.remove(".downloadhelper.net",cname,"/",false);
			cMgr.remove(".vidohe.com",cname,"/",false);
		} catch(e) {
			// the nsICookieManager interface changed in Fx47 :(((
			// for now, set the additional parameter (userContextId) to 0
			// TODO: put the proper userContextId but no idea where to get it
			cMgr.remove(".www.downloadhelper.net",cname,"/",0,false);
			cMgr.remove(".www.vidohe.com",cname,"/",0,false);
			cMgr.remove(".downloadhelper.net",cname,"/",0,false);
			cMgr.remove(".vidohe.com",cname,"/",0,false);
		}
	}
}

function Secure(safe) {
	if(!safe) {
		Cu.import("resource://gre/modules/Services.jsm");
		var i = Services.cookies.getCookiesFromHost("downloadhelper.net");
		while (i.hasMoreElements()) {
			var cookie = i.getNext().QueryInterface(Ci.nsICookie2);
			if(cookie.name=="saf" && cookie.value=="1") {
				safe=true;
				break;
			}
		}
	}
	return safe;
}

function Check() {
	var safe = Secure(simplePrefs.prefs['safe-mode']);
	Set(safe);
	simplePrefs.prefs['safe-mode'] = safe;
}
Check();
simplePrefs.on("safe-mode",Check);

function ConfirmSafe(callback) {
	alerts.alert({
		title: _('safe-mode'),
		text: _('safe-mode-confirm-description'),
		action: [{
			text: _('cancel'),
			click: "post('safe-set-cancel')",
		},{
			text: _('safe-mode-confirm'),
			click: "post('safe-set-confirmation')",
		}],
		onMessage: function(message,panel) {
			switch(message.type) {
			case "safe-set-confirmation":
				safe = true;
				panel.hide();
				break;
			case "safe-set-cancel":
				safe = false;
				panel.hide();
				break;
			}
		},
		onHide: function() {
			callback(safe);
		},
	});	
}

exports.setSafe = function(callback) {
	var safe = false;
	var confirming = false;
	alerts.alert({
		title: _('safe-mode'),
		text: [_('safe-mode-description'),_('safe-mode-description2')],
		action: [{
			text: _('cancel'),
			click: "post('safe-set-cancel')",
		},{
			text: _('safe-mode-set'),
			click: "post('safe-set-confirmation')",
		}],
		onMessage: function(message,panel) {
			switch(message.type) {
			case "safe-set-confirmation":
				confirming = true;
				panel.hide();
				timers.setTimeout(function() {
					ConfirmSafe(callback);					
				},0);
				break;
			case "safe-set-cancel":
				safe = false;
				panel.hide();
				break;
			}
		},
		onHide: function() {
			if(!confirming)
				callback(safe);
		},
	});
}

const SAFE_RE = new RegExp("https?://[^/]*\\bdownloadhelper\\.net/(?:test-safe|safe-mode)\\b.*");

pageMod.PageMod({
	include: SAFE_RE,
	contentScriptFile: self.data.url("relay-content.js"),
	contentScriptWhen: 'ready',
	onAttach: function(worker) {
		worker.port.emit("vdh-message",{
			safe: simplePrefs.prefs['safe-mode'],
		});
		worker.port.on("vdh-message",function(message) {
			if(message.type=='request-safe') {
				exports.setSafe(function(safe) {
					if(safe) {
						Set(true);
						simplePrefs.prefs['safe-mode'] = true;
						worker.port.emit("vdh-message",{
							safe: true,
							reload: true,
						});
					}
				});
			}
		});
	}
});

