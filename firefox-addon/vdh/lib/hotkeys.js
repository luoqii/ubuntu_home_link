/* Copyright (C) 2006-2016 Michel Gutierrez <mig@downloadhelper.net>
 * All Rights Reserved
 * 
 * If you are interested in methods used in this project, follow the
 * open source project at https://github.com/mi-g/fang
 */


const simplePrefs = require("sdk/simple-prefs");
var { Hotkey } = require("sdk/hotkeys");
const windows = require("sdk/windows").browserWindows;
const { viewFor } = require("sdk/view/core");

var keys = {
	'default': {
		onPress: function() {
			require("./hits").defaultAction();
		},
	},
	'opencompanion': {
		onPress: function() {
			var window = viewFor(windows.activeWindow);
			var document = window.document;
			var companion = document.getElementById("vdh-companion");
			if(companion)
				companion.open = true;
		},
	},
	'detect-gallery': {
		onPress: function() {
			require("./gallery").checkCurrentPage();
		},		
	},
	'clear-hits': {
		onPress: function() {
			require("./hits").clear("all");
		},		
	},
	'supported-sites': {
		onPress: function() {
			require("./sites").show();
		},		
	},
	'convert-local': {
		onPress: function() {
			require("./converter").convertLocal();
		},		
	},
	'toggle-scrap': {
		onPress: function() {
			require("./scrap").action({action:'toggle'});
		},		
	},
}

function UpdateKeys() {
	for(var id in keys) {
		var key = keys[id];
		if(key.hotkey) {
			key.hotkey.destroy();
			delete key.hotkey;
		}
		var combo = simplePrefs.prefs['hotkey.'+id];
		if(combo)
			(function(key) {
				key.hotkey = Hotkey({
					combo: combo,
					onPress: function() {
						key.onPress();
					},
				});				
			})(key);
	}
}

UpdateKeys();

const HKPREF_RE = new RegExp("^hotkey\\.");

simplePrefs.on("",function(prefName) {
	if(HKPREF_RE.test(prefName))
		UpdateKeys();
});

