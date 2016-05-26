/* Copyright (C) 2006-2016 Michel Gutierrez <mig@downloadhelper.net>
 * All Rights Reserved
 * 
 * If you are interested in methods used in this project, follow the
 * open source project at https://github.com/mi-g/fang
 */


var windowLocation = window.location.href; 

self.port.emit("pageurl",{
	url: windowLocation,
});

self.port.on("get-title",function(message) {
	var specs = message.specs.concat([{
		xpath: "/html/head/title",
	}]);
	for(var i = 0;i<specs.length;i++) {
		var spec = specs[i];
		var title = null;
		try {
			title = document.evaluate(spec.xpath,document, null, XPathResult.STRING_TYPE, null).stringValue;
		} catch($_) {
		}
		if(title) {
			try {
				var re = new RegExp(spec.regexp || ".*","g");
				var match = re.exec(title.trim().replace(/\s+/g,' '));
				if(match) {
					if(match[1])
						title = match[1];
					else
						title = match[0];
					if(title.length==0)
						title = null;
				} else
					title = null;
			} catch(e) {
				title = null;
			}
		}
		if(title) {
			self.port.emit("pagedata",{
				title: title,
				url: windowLocation,
			});
			return;
		}
	}
	self.port.emit("pagedata",{
		title: null,
		url: windowLocation,
	});
});
