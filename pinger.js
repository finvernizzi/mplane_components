/**
 * Pinger probe implementing the Capability push, Specification pull model
 *
 * @author fabrizio.invernizzi@telecomitalia.it
 * @version 0.2.0
 *
 */

var exec = require('child_process').exec,
    mplane = require('mplane')
    ,supervisor = require("mplane_http_transport")
    , _ = require("lodash"),
    url = require('url'),
    async = require("async")
    ,fs = require('fs')
    ,cli = require("cli");

var CONFIGFILE = "pinger.json"; //TODO:This should be overwrittable by cli

//-----------------------------------------------------------------------------------------------------------
// READ CONFIG
var configuration;
try {
    configuration = JSON.parse(fs.readFileSync(CONFIGFILE));
}
catch (err) {
    console.log('There has been an error parsing the configuration file.')
    console.log(err);
    process.exit();
}
//-----------------------------------------------------------------------------------------------------------


// CLI params
cli.parse({
    sourceIP:['i' , 'Source IP' , 'string' , configuration.main.ipAdresses[0]],
    platform:['p' , 'Platform (BSD,MAC,LINUX)' , 'string' , configuration.main.platform],
    systemID:['s' , 'System identification' , 'string' , configuration.main.systemID],
    label:['l' , 'System label' , 'string' , configuration.main.label]
});

var connected = false;
var capability = [];

// Initialize available primitives from the registry
mplane.Element.initialize_registry("registry.json");

var pingerCapability = new mplane.Capability();
pingerCapability.set_when("now ... future / 1s");
pingerCapability.add_parameter({
    type:"destination.ip4",
    constraints:configuration.pinger.constraints
}).add_parameter({
    type:"number",
    constraints:"1 ... 10"
}).add_parameter({
        type:"source.ip4",
        constraints:cli.options.sourceIP
}).add_result_column("delay.twoway")
    .set_metadata_value("System_type","Pinger")
    .set_metadata_value("System_version","0.1a")
    .set_metadata_value("System_ID",cli.options.systemID).update_token();
pingerCapability.set_label(configuration.main.pingerLabel);
capability.push(pingerCapability);

var traceCapability = new mplane.Capability();
traceCapability.set_when("now ... future / 1s");
traceCapability.add_parameter({
    type:"destination.ip4",
    constraints:configuration.traceroute.constraints
}).add_parameter({
    type:"source.ip4",
    constraints:cli.options.sourceIP
}).add_result_column("delay.twoway").add_result_column("hops.ip")
    .set_metadata_value("System_type","Tracer")
    .set_metadata_value("System_version","0.1a")
    .set_metadata_value("System_ID",cli.options.systemID).update_token();
traceCapability.set_label(configuration.main.tracerouteLabel);
capability.push(traceCapability);

pushCapPullSpec(capability);
var recheck = setInterval(function(){
    if (!connected){
        console.log("Supervisor unreachable. Retry in "+configuration.main.retryConnect/1000 + " seconds...");
        pushCapPullSpec(capability);
    }else{
        console.log("------------------------------");
        console.log("");
        console.log("Checking for Specifications...");
        console.log("");
        console.log("------------------------------");
        clearInterval(recheck);
    }
} , configuration.main.retryConnect);

function pushCapPullSpec(capabilities){
    console.log("***************************");
    console.log("REGISTERING MY CAPABILITIES");
    console.log("***************************\n");
    supervisor.registerCapabilities(capabilities , {
            host: configuration.supervisor.host
            ,port: configuration.supervisor.port
            ,caFile: configuration.ssl.ca
            ,keyFile: configuration.ssl.key
            ,certFile: configuration.ssl.cert
        },function(err , data){
            if (err){
                return false;
            }else{
                connected = true;
                supervisor.checkSpecifications(
                    {
                        host: configuration.supervisor.host
                        ,port: configuration.supervisor.port
                        ,caFile: configuration.ssl.ca
                        ,keyFile: configuration.ssl.key
                        ,certFile: configuration.ssl.cert
                        ,period: configuration.main.ceckSpecificationPeriod
                    }
                    ,function(specification , callback){
                        var label = specification.get_label();
                        // FIXME: this MUST be changed!!!
                        specification.set_when("2014-09-29 10:19:26.765203 ... 2014-09-29 10:19:27.767020");
                        if (label ==  configuration.main.pingerLabel){
                            execPing( specification , callback);
                        }
                        if (label ==  configuration.main.tracerouteLabel){
                            //execPing( specification , callback);
                            execTraceroute(specification, callback);
                        }
                    }, function(err){
                        // For some reason we have no capability registered
                        if (err.message == 428){
                            pushCapPullSpec(capabilities);
                        }
                        else
                            console.log(err);
                    }
                );
                return true;
            }
        }
    );

}

function mean(values){
    var sum = 0 , elements = 0;
    _.each(values , function(val , index){
        if (!_.isNaN(val)){
            sum += val*1;
            elements +=1;
        }
    });
    return (sum/elements);
}
/**
 *
 * @param specification The mplane Specification
 */
function execPing(specification, mainCallback){
    var dest = specification.get_parameter_value("destination.ip4");
    var reqNum = specification.get_parameter_value("number");
    async.waterfall([
        function(callback){
            doAPing(dest, 5 , reqNum , callback);
        }
    ], function (err, meanRTT) {
        console.log("delay.twoway <"+dest+">:"+meanRTT);
        supervisor.registerResult(
            specification
            , {
                host: configuration.supervisor.host
                ,port: configuration.supervisor.port
                ,caFile: configuration.ssl.ca
                ,keyFile: configuration.ssl.key
                ,certFile: configuration.ssl.cert
            },{
                "delay.twoway":meanRTT
            }
            ,function(err , data){
                mainCallback();
                /*if (err)
                    mainCallback(err);
                else{
                    mainCallback();
                }*/
            }
        ); //supervisor.registerResult
    }); //waterfall
}

/**
 *
 * @param specification The mplane Specification
 */
function execTraceroute(specification, mainCallback){
    var dest = specification.get_parameter_value("destination.ip4");
    async.waterfall([
        function(callback){
            //console.log("Tracing to "+dest);
            doATrace(dest , function (err,hops) {
                if (err){
                    callback(err , null);
                }else{
                    callback(null , hops);
                }
            });
        }
    ], function (err, hops) {
        if (err){
            console.log(err);
        }else{
            supervisor.registerResult(
                specification
                , {
                    host: configuration.supervisor.host
                    ,port: configuration.supervisor.port
                    ,caFile: configuration.ssl.ca
                    ,keyFile: configuration.ssl.key
                    ,certFile: configuration.ssl.cert
                },{
                    "delay.twoway":mean(hops),
                    "hops.ip":hops.length
                }
                ,function(err , data){
                    mainCallback();
                    /*if (err)
                        mainCallback(err);
                    else{
                        mainCallback();
                    }*/
                }
            ); //supervisor.registerResult
        }
    }); //waterfall
}

function doAPing(destination , Wait , requests , callback){
    var pingCMD = "";
    switch (cli.options.platform){
        case "BSD":
            pingCMD = "ping -n -S " + cli.options.sourceIP + "  -W "+ Wait  +" -c " + requests + " " + destination  + " | grep from";
            break;
        case "MAC":
            pingCMD = "ping -n -S " + cli.options.sourceIP + "  -W "+ Wait*100  +" -c " + requests + " " + destination  + " | grep time";
        case "LINUX":
            pingCMD = "ping -n -A -I " + cli.options.sourceIP + "  -W "+ Wait  +" -c " + requests + " " + destination  + " | grep time";
            break;
        default:
            throw (new Error("Unsupported platform "+cli.options.platform));

    }
 exec(pingCMD,
  function (error, stdout, stderr) {
      var times = [];
    if (!stdout)
        console.log("No answer")
    else{
        var replies = stdout.split(/\n/);
        _.each(replies , function(row , index){
            var vals = row.split(/[\t\s]+/);
            _.each(vals, function(el , index){
                var element = el.split("=");
                switch(element[0]){
                    case "time":
                        if (!_.isUndefined(element[1]))
                            times.push(element[1]);
                        break;
                    default:
                        // nothing to do here
                }
            });
        });
        callback(null, mean(times));
    }
    if (error !== null) {
      callback(error , null);
    }
  });
}

function doATrace(destination , callback){
    exec(configuration.main.tracerouteExec + " " + configuration.main.tracerouteOptions + " -s " + cli.options.sourceIP + " " + destination,
        function (error, stdout, stderr) {
            var delays = [];
            if (error || !stdout){
                //callback(new Error("No answer" , null));
                console.log("No answer")
                //return;
            }
            else{
                var rows = stdout.split(/\n/);
                _.each(rows , function(row , index){
                    var vals = row.split(/[\t\s]+/);
                    console.log(vals)
                    // Simple and stupid check...
                    vals.forEach(function(val  , index){
                        if(val == "ms"){
                            console.log(vals[index -1]);
                            delays.push(vals[index -1]);
                        }

                    });
                    //if (vals[(vals.length) -1] == 'ms')

                });
                callback(null, delays);
            }
            /*if (error !== null) {
                callback(error , null);
            }*/
        });
}
