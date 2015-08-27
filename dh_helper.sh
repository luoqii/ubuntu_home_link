#!/usr/bin/env bash
# write http url to file on start
# & delete file when download successfully only.

for (( ;; )) do 
read line
if [[ $? != 0 ]] ; then
exit
fi
echo $line
if [[ $line =~ bysongstart ]] ; then
	cmd=`echo $line |sed -e 's/bysongstart|\([^|]*\)|\([^|]*\)/echo \2 >  \1.txt/'`
	echo cmd: $cmd
	bash -c "$cmd"
fi
if [[ $line =~ bysongend ]] ; then
        cmd=`echo $line |sed -e 's/bysongend|\([^|]*\)|\([^|]*\)/rm \1.txt/'`
        echo cmd: $cmd
        bash -c "$cmd"
fi

done
