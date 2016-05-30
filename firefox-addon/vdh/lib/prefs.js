/* Copyright (C) 2006-2016 Michel Gutierrez <mig@downloadhelper.net>
 * All Rights Reserved
 * 
 * If you are interested in methods used in this project, follow the
 * open source project at https://github.com/mi-g/fang
 */


const simplePrefs = require('sdk/simple-prefs');
const {Cc, Ci, Cu} = require("chrome"); 
const prefService=Cc["@mozilla.org/preferences-service;1"].getService(Ci.nsIPrefService);

var prefs = {};
var listeners = [];

function MigratePrefs() {
	var prefBranch=prefService.getBranch("dwhelper.");
	var oldPrefs = prefBranch.getChildList("",{});
	oldPrefs.forEach(function(prefKey) {
		var prefType = prefBranch.getPrefType(prefKey);
		var prefValue;
		if(prefType==prefBranch.PREF_STRING)
			prefValue = prefBranch.getCharPref(prefKey);
		else if(prefType==prefBranch.PREF_BOOL)
			prefValue = prefBranch.getBoolPref(prefKey);
		else if(prefType==prefBranch.PREF_INT)
			prefValue = prefBranch.getIntPref(prefKey);
		if(prefValue!==undefined)
			if(simplePrefs.prefs[prefKey] !== undefined)
				simplePrefs.prefs[prefKey] = prefValue;
	});
	prefBranch.deleteBranch("");
	simplePrefs.prefs["need-prefs-migration"]=false;
}

if(simplePrefs.prefs["need-prefs-migration"])
	MigratePrefs();

function LoadPrefs() {
	var prefBranch=prefService.getBranch("extensions.dwhelper.");
	prefBranch.getChildList("",{}).forEach(function(prefKey) {
		var prefType = prefBranch.getPrefType(prefKey);
		var prefValue;
		if(prefType==prefBranch.PREF_STRING)
			prefValue = prefBranch.getCharPref(prefKey);
		else if(prefType==prefBranch.PREF_BOOL)
			prefValue = prefBranch.getBoolPref(prefKey);
		else if(prefType==prefBranch.PREF_INT)
			prefValue = prefBranch.getIntPref(prefKey);
		if(prefValue!==undefined)
			if(simplePrefs.prefs[prefKey] !== undefined)
				prefs[prefKey] = prefValue;
	});	
}
LoadPrefs();

simplePrefs.on("",function(prefKey) {
	var newValue = simplePrefs.prefs[prefKey];
	if(newValue !== prefs[prefKey]) {
		prefs[prefKey] = newValue;
		listeners.forEach(function(listener) {
			listener(prefKey,newValue);
		});
	}
});

exports.prefs = prefs;

exports.addListener = function(listener) {
	listeners.push(listener);
}

exports.removeListener = function(listener) {
	var index = listeners.indexOf(listener);
	if(index>=0)
		listeners.splice(index,1);
}

exports.set = function(newPrefs) {
	for(var prefName in newPrefs) {
		var prefValue = newPrefs[prefName];
		if(prefValue != prefs[prefName])
			simplePrefs.prefs[prefName] = prefValue;
	}
}
