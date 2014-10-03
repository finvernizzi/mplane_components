mplane_components
=================

[![mPlane](http://www.ict-mplane.eu/sites/default/files//public/mplane_final_256x_0.png)](http://www.ict-mplane.eu/)


This package contains working examples of three [mPlane](http://www.ict-mplane.eu/) components: a Supervisor, a probe (ping and traceroute) and a simple client for the supervisor. 
The implementation leverages mPlane nodej library and mPlane HTTPS transport library.
A complete set of working SSL certificates is provided (with root-CA and signing-CA) in order to have a complete, full working environment. 
For security reasons you SHOULD update these files with your own certificates.

#Installation

```git clone https://github.com/finvernizzi/mplane_components.git```

This command will install all the components in the mplane_components folder.

```
mPlaneTEST# ls ./mplane_components/
README.md       node_modules    pinger.json     ssl_files.js
client.js       package.json    registry.json   supervisor.js
client.json     pinger.js       ssl             supervisor.json
```

Now you need to install all the nodejs dependencies
```
cd ./mplane_components
npm install
```


#Components
After installation you will find three different components installed in your npm root directory:

- supervisor
- client
- pinger
    
##Supervisor
    
This is a working example of an mPlane supervisor. In order to change the configuration edit the supervisor.json file.
This an example of working config

```json
{
    "main":{
        "logFile":"/var/log/mplane/supervisor.log",
        "listenPort":2427,
        "hostName":"mplane.org"
    },
    "ssl":{
        "key": "./ssl/official/Supervisor2/Supervisor-2-plaintext.key.pem"
        ,"cert": "./ssl/official/Supervisor2/Supervisor-2.crt.pem"
        ,"ca": [ "./ssl/official/root-ca.pem" , "./ssl/official/signing-ca.pem" ]
        ,"requestCert" : true
    }
}
```

To start the supervisor simply digit
```
node ./supervisor
```

##Client
This is a simple remote cli to interact with the supervisor.
Configuration file is client.json.
```json
{
    "main":{
        "logFile":"/var/log/mplane/client.log",
        "version":"1.0",
        "description": "mPlane supervisor client",
        "prompt_separator":"#",
        "minimum_columns_required":150,
        "process_name": "mPlane supervisor CLIENT"
    },
    "supervisor":{
        "listenPort":2427,
        "hostName":"mplane.org"
    },
    "registry":{
        "file":"./registry.json"
    },
    "ssl":{
        "key": "./ssl/official/Client1/Client-1-plaintext.key.pem"
        ,"cert": "./ssl/official/Client1/Client-1.crt.pem"
        ,"ca": [ "./ssl/official/root-ca.pem" , "/usr/script/DATIProxy/ssl/official/signing-ca.pem" ]
        ,"requestCert" : true
    }
}
```

To run the client
```
node ./client
```

##Probe
This is a simple probe that exposes two capabilities
    . pinger
    . traceroute

Configuration of this probe can be done in pinger.json
 
```json
{
    "main":{
        "logFile":"/var/log/mplane/pinger.log",
        "retryConnect":5000,
        "pingerLabel": "pinger_TI_test",
        "tracerouteLabel": "tracer_TI_test",
        "ipAdresses" : ["192.168.0.1"],
        "tracerouteExec": "/usr/sbin/traceroute",
        "tracerouteOptions": "-q1 -n -w1 -m5"
    },
    "supervisor":{
        "host": "mplane.org",
        "port": 2427
    },
    "ssl":{
        "key": "./ssl/official/Component1/Component-1-plaintext.key"
        ,"cert": "./ssl/official/Component1/Component-1.crt.pem"
        ,"ca": [ "./ssl/official/root-ca.pem" , "./ssl/official/signing-ca.pem" ]
        ,"requestCert" : true
    }
}
```

The implementation is very simple, and tested only on FreeBSD 9.3, so some changes may be required in order to fully work on other platform.
In particular two functions should be checked:
- doAPing. This function executes the ping with parameters received in Specifications. The command is 
       ```javascript exec("ping -S " + __MY_IP__ + "  -W "+ Wait  +" -c " + requests + " " + destination  + " | grep from"```
    
- doATrace.This function executes the traceroute with parameters received in Specifications. The command is 
        ```javascript exec(configuration.main.tracerouteExec + " " + configuration.main.tracerouteOptions + " -s " + __MY_IP__ + " " + destination```
         
         