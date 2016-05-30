/* Copyright (C) 2006-2016 Michel Gutierrez <mig@downloadhelper.net>
 * All Rights Reserved
 * 
 * If you are interested in methods used in this project, follow the
 * open source project at https://github.com/mi-g/fang
 */


(function() {
	
	window.addEventListener('message', function(event) {
		if(!event.data.fromContent)
			return;
		self.port.emit("vdh-message",event.data);
	}, false);

	self.port.on("vdh-message",function(message) {
		message.fromAddon = true;
		window.postMessage(message,'*');
	});
	
})();
