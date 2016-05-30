/* Copyright (C) 2006-2016 Michel Gutierrez <mig@downloadhelper.net>
 * All Rights Reserved
 * 
 * If you are interested in methods used in this project, follow the
 * open source project at https://github.com/mi-g/fang
 */


angular.module('VDH').controller('VDHTpsrCtrl', 
	['$scope', '$document', 'VDH.util',
	 	function($scope,$document,VDHUtil) {
			VDHUtil.prepareScope($scope);
			$scope.data = {
				advanced: false,
			}
			$scope.start = function() {
				$scope.post("start",{ search: angular.element(document.querySelector('#tpsrSearch1')).val() });
			}
			$scope.installConverter = function() {
				$scope.post("goto", { where: "converter" })
			}
	}]);
