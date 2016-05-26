/* Copyright (C) 2006-2016 Michel Gutierrez <mig@downloadhelper.net>
 * All Rights Reserved
 * 
 * If you are interested in methods used in this project, follow the
 * open source project at https://github.com/mi-g/fang
 */


const { Ci, Cu } = require('chrome');
const { Services } = Cu.import("resource://gre/modules/Services.jsm", {});

const DEFAULT_LOCALE = "en-US";

exports.bestMatchingLocale = DEFAULT_LOCALE;
exports.hash = {};

function LoadLocale(locale) {
	locale = FixLocaleCase(locale);
	var rootURI = require("@loader/options").rootURI;
	var bundle = Services.strings.createBundle(rootURI+"locale/"+locale+".properties");
	var i;
	try {
		i = bundle.getSimpleEnumeration();
	} catch(e) {
		return;
	}
	if(i.hasMoreElements()) {
		exports.bestMatchingLocale = locale;
		do {
			var item = i.getNext().QueryInterface(Ci.nsIPropertyElement);
			exports.hash[item.key] = item.value;
		} while(i.hasMoreElements());
	}
}

function FixLocaleCase(locale) {
	var m = /^(.*?-)(.*)$/.exec(locale);
	if(m)
		return m[1]+m[2].toUpperCase();
	else
		return locale;
}

function LoadL10n() {
	var locales = require("sdk/l10n/locale").getPreferedLocales(true);
	locales.forEach(function(locale,index) {
		locales[index] = FixLocaleCase(locale); 
	});
	if(!(DEFAULT_LOCALE in locales))
		LoadLocale(DEFAULT_LOCALE);
	while(locales.length)
		LoadLocale(locales.pop());
}

LoadL10n();
