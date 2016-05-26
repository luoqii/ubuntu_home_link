/* Copyright (C) 2006-2016 Michel Gutierrez <mig@downloadhelper.net>
 * All Rights Reserved
 * 
 * If you are interested in methods used in this project, follow the
 * open source project at https://github.com/mi-g/fang
 */


var m = /^(.*)\/card$/.exec(window.location.href);
if(m) {
	window.postMessage({
	    fromContent: true,
	    type: 'detected-links',
	    links: [m[1]],
	},'*');
}


