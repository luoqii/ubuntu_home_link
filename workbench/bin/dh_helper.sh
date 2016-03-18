#!/usr/bin/env bash
# write http url to file on start
# & delete file when download successfully only.

for (( ;; )) do 
	read line
	if [[ $? != 0 ]] ; then
		exit
	fi
	#echo line: $line
	#bysongend|/home/bysong/dwhelper/123456789.mp4|http://www.example.com

	if [[ $line =~ bysongstart || $line =~ bysongend ]] ; then
		tag=`echo $line | sed -e 's/\([^|]*\)|\([^|]*\)|\([^|]*\)/\1/'`
		file=`echo $line | sed -e 's/\([^|]*\)|\([^|]*\)|\([^|]*\)/\2/'`
		url=`echo $line | sed -e 's/\([^|]*\)|\([^|]*\)|\([^|]*\)/\3/'`
		url_file=${file}.txt
		echo "tag     : $tag"
		echo "file    : $file"
		echo "url     : $url"
		echo "url_file: $url_file"
	fi
	
	if [[ $line =~ bysongstart ]] ; then

		cmd=`echo $line |sed -e 's/bysongstart|\([^|]*\)|\([^|]*\)/echo "\2" >  \1.txt/'`
		echo cmd: $cmd
		bash -c "$cmd"

                # do backup
		# back is important
		cDir=`dirname $file`
		cDir=$cDir/backup
		mkdir -p $cDir
		echo cDir: $cDir
		cp $url_file $cDir
	fi
	if [[ $line =~ bysongend ]] ; then
       		#file=`echo $line |sed -e 's/bysongend|\([^|]*\)|\([^|]*\)/\1/'`
		echo file: $file
		head=`head -c 4 $file`
		echo head: $head
		if [[ "$head" != "<?xm" && "$head" != "<htm" && '$head" != "http" ]] ; then
        		cmd=`echo $line |sed -e 's/bysongend|\([^|]*\)|\([^|]*\)/rm \1.txt/'`
        		echo cmd: $cmd
        		bash -c "$cmd"
        	fi
	fi

done
