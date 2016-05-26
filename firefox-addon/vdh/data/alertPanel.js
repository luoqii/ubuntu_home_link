/* Copyright (C) 2006-2016 Michel Gutierrez <mig@downloadhelper.net>
 * All Rights Reserved
 * 
 * If you are interested in methods used in this project, follow the
 * open source project at https://github.com/mi-g/fang
 */


angular.module('VDH').controller('VDHAlertCtrl', 
	['$scope', 'VDH.util',
	 	function($scope,VDHUtil) {
			VDHUtil.prepareScope($scope);
			$scope.$watch("options",function(options) {
				if(!options)
					return;
				options.text = options.text || [];
				if(typeof options.text == "string")
					options.text = [ options.text ];
				options.action = options.action || [];
				if(!angular.isArray(options.action))
					options.action = [ options.action ];
			},true);
			$scope.click = function(action) {
				if(action.click)
					$scope.$eval(action.click);
			}
			$scope.buttonClasses = function(button) {
				return ["btn", button.buttonClass || "btn-normal"].join(" ");
			}
	}]);

