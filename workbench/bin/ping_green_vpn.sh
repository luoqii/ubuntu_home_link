#!/usr/bin/env bash


SERVER="
a.usgjsq.net
b.usgjsq.net
c.usgjsq.net
d.usgjsq.net
e.usgjsq.net
f.usgjsq.net
g.usgjsq.net
h.usgjsq.net

ca.igjsq.net

uk1.igjsq.net
uk2.igjsq.net

de1.igjsq.net
de2.igjsq.net

es.igjsq.net

fr1.igjsq.net
fr2.igjsq.net

ru.igjsq.net

a.twgjsq.com
b.twgjsq.com
c.twgjsq.com

a.hkgjsq.com
b.hkgjsq.com
c.hkgjsq.com


a.jpgjsq.com
b.jpgjsq.com
c.jpgjsq.com
d.jpgjsq.com
e.jpgjsq.com
f.jpgjsq.com

a.sggjsq.com
b.sggjsq.com
c.sggjsq.com
d.sggjsq.com
e.sggjsq.com

a.krgjsq.com
b.krgjsq.com

"
COUNT=10
for server in $SERVER ; do

echo server: $server
ping -c $COUNT $server | grep rtt
done

