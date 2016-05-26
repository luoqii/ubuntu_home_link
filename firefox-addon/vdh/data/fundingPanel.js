/* Copyright (C) 2006-2016 Michel Gutierrez <mig@downloadhelper.net>
 * All Rights Reserved
 * 
 * If you are interested in methods used in this project, follow the
 * open source project at https://github.com/mi-g/fang
 */


angular.module('VDH').controller('VDHFundingCtrl', 
	['$scope', 'VDH.util',
	 	function($scope,VDHUtil) {
			VDHUtil.prepareScope($scope);
			$scope.donate = function() {
				$scope.post('donate',{});
			}
			$scope.notAgain = function() {
				$scope.post('donate-later',{});
			}
			$scope.review = function() {
				$scope.post('review',{});
			}
	}]);

