/**
 * mPlane supervisor example
 *
 * @author fabrizio.invernizzi@telecomitalia.it
 * @version 0.1.0b
 *      Capability push, Specification pull paradigm ONLY
 *
 */

// TODO LEGGERE TUTTI I PATH dal file esterno di interazione in modo che ho un posto unico dove li modifico
var SSL = true;

var mplane = require('mplane'),
    express = require('express'),
    morgan  = require('morgan'),
    app = express(),
    inquirer = require("inquirer"),
    _ = require("lodash"),
    prettyjson = require('prettyjson'),
    bodyParser = require('body-parser'),
    https = require('https'),
    http = require('http')
    supervisor = require("mplane_http_transport"),
    fs = require('fs'),
    ssl_files = require("./ssl_files");


var CONFIGFILE = "supervisor.json"; //TODO:This should be overwrittable by cli

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

var ssl_options = {
    key: ssl_files.readFileContent(configuration.ssl.key)
    ,cert: ssl_files.readFileContent(configuration.ssl.cert)
    ,ca: ssl_files.readCaChain(configuration.ssl.ca)
    ,requestCert: configuration.ssl.requestCert
    ,rejectUnauthorized: false // So we can decide in the app!
};

// Log all requests to file
app.use(morgan("combined" ,{ "stream":fs.createWriteStream(configuration.main.logFile)}));

var httpsServer = https.createServer(ssl_options, app);

httpsServer.on("clientError" , function(exception, securePair){
    console.log(exception);
    console.log("--- ------- ---");
    console.log(securePair);
    console.log("--- clientError ---");
});

// FIXME:  implement cli params to overwrite config default
httpsServer.listen(configuration.main.listenPort);

// Internal specification status
var __SPEC_STATUS_QUEUED_="queued";
var __SPEC_STATUS_PROBE_TAKEN_="taken";
var __SPEC_STATUS_RESULT_READY_="result_ready";

// Process name for ps
process.title = "mPlane supervisor";

/***************************
 *
 * Global DATA STRUCTURES
 *
 ************************/

// List of capabilities registerd to this supervisor
// Each element is identified by its unique DN and each capability by its token
var __registered_capabilities__ = {};
// List of required measures, indexed by probe token
// Capability push, Specification pull paradigm
var __required_specifications__ = {};
// Index of receipt tokens with link to registered capabilities
// The keys are the receipt tokens, and each obj contains cohordinates for accessing the specification in __required_specifications__
// example {"38be4396e4e3691157b65425727dba9e092e0fc8":{dn:... , label:... , specificationToken:...}}
var __sent_receipts__ = {};

// Result obtained by probes
var __results__ = {};
// List of all DN that have done at least a register capability
var __registered_DN__= [];

/***************************/

// Load the reference registry
mplane.Element.initialize_registry("registry.json");

// ---------------------------------------------------------------
// WEB server
// ---------------------------------------------------------------
app.use(function(req, res, next){
    // Is the client claimimng a valid certificate?
    if (req.client.authorized){
        next();
    }else{
       res.writeHead("403", {
            'Error': "Invalid certificate or no certificate provided"
        });
        res.end("Invalid certificate or certificate not provided");
    }
});

// MPLANE uses application/x-mplane+json
app.use(bodyParser.json({type:"application/*"}));

/**
 * We have received a POST message with a register for a capability
 * The data structrure is : [DN][token] where token can be the capability token or the label
 */
app.post(supervisor.SUPERVISOR_PATH_REGISTER_CAPABILITY, function(req, res){
    __registered_DN__.push(DN(req));
    __registered_DN__ = _.uniq(__registered_DN__);

    var newCapability
        ,port = configuration.main.listenPort
        ,proto="https";
    // We receive a Json containing multiple capability
    var received = req.body;
    var ret = {}; // Return array
    _.each(received , function(cap){
        newCapability = mplane.from_dict(cap);

        // Check if we received a capability.
        if (!(newCapability instanceof mplane.Capability)){
            // Bad Request
            var tmp= {};
            ret[newCapability.get_label()] =  {registered:"no",reason: "mPlane Error : not a Capability/wrong format"};
        }else{ // OK
            var tmp= {};
            ret[newCapability.get_label()] =  {registered:"ok"};
            // First check if already registered, then register
            var registered = capabilityAlreadyRegistered(newCapability , DN(req)),
                newToken = registerCapability(newCapability , DN(req));
        }
    });
    res.send(JSON.stringify(ret));
});

/**
 * SomeOne sending a SPECIFICATION
 * We expect the json form:{DistinguishedName:{specification}}. This allows for send specification for a different DN from sender (es a client registering a specification for a probe)
 *
 */
//app.post('/register/specification', function(req, res){
app.post(supervisor.SUPERVISOR_PATH_REGISTER_SPECIFICATION, function(req, res){
    var dns = _.keys(req.body); // We expect to have a DN as key, so dn[0] should be the DN
    var newSpecification = mplane.from_dict(req.body[dns[0]]);
    if (!(newSpecification instanceof mplane.Specification)){
        // Bad Request
        res.writeHead(400, {
            'Error': "mPlane error: not a specification/wrong format"
        });
        res.end();
    }else{
        var dn = dns[0];
        var label = newSpecification.get_label();
        var specToken = newSpecification.get_token();
        if (!__required_specifications__[dn])
            __required_specifications__[dn] = {}; // We can have multiple request for a single component
        if (!__required_specifications__[dn][label])
            __required_specifications__[dn][label] = {}; // We can have multiple request for a single capability of a dn
        newSpecification.specification_status = __SPEC_STATUS_QUEUED_;
        __required_specifications__[dn][label][specToken]= {};
        __required_specifications__[dn][label][specToken]= newSpecification;
        __required_specifications__[dn][label][specToken]['eventTime']= new Date(); // When we received the specification

        // Receipt
        receipt = new mplane.Receipt(newSpecification);
        // We keep an index to easily access from the receipt token the associated specification/results
        if (!__sent_receipts__[receipt.get_token()])
            __sent_receipts__[receipt.get_token()] = {};
        __sent_receipts__[receipt.get_token()] = {dn:dn , label: label, specificationToken:specToken};
        res.send(receipt.to_dict());
    }
});


// For show
app.param('itemType', function(req,res, next, itemType){
    req.itemType = itemType;
    next();
});
app.param('itemHash', function(req,res, next, itemHash){
    req.itemHash = itemHash;
    next();
});
/*
 A probe query for available specifications
 */
var tokenReq = null;
app.param('token', function(req,res, next, token){
    tokenReq = null;
    var t = token.split("=");
    if (t[1])
        tokenReq = t[1];
    next();
});
/**
 * Someone is asking for specification(s)
 * We recognize the requester by its DN
 * If it is a registered probe, we send only its specifications, otherwise we send a 428 code with no specification
 */
app.get(supervisor.SUPERVISOR_PATH_SHOW_SPECIFICATION, function(req, res){
    var ret = []
        , statusCode = 200
        ,DNs = [];//Here we put all the DNs for filtering specifications from
    var dn = DN(req);
    console.log(":::"+DN)
	if (dn) {
        // If the dn has at least a registered capability, send only its specifications, else ALL specifications
        if (__registered_DN__.indexOf(dn) != -1){
            DNs.push(dn);
        }else{
            //statusCode = 428;
            _.each(_.keys(__required_specifications__), function(curDN){
                DNs.push(curDN);
            })
        }
        DNs.forEach(function(d,index){
            _.each(_.keys(__required_specifications__[d]) , function(label){
                _.each(_.keys(__required_specifications__[d][label]) , function(specHash){
                    if ((__required_specifications__[d][label][specHash].specification_status == __SPEC_STATUS_QUEUED_)) {
                        var spec = new mplane.Specification(__required_specifications__[d][label][specHash]);
                        // Usefull meta info
                        spec.set_metadata_value("eventTime",__required_specifications__[d][label][specHash].eventTime);
                        spec.set_metadata_value("specification_status",__required_specifications__[d][label][specHash].specification_status);
                        spec.set_when("now + 1s");
                        // to_dict output is a string, but here we need a json.
                        // Better this solution to keep the API
                        ret.push(JSON.parse(spec.to_dict()));
                        // Supervisor internal status
                        __required_specifications__[d][label][specHash].specification_status = __SPEC_STATUS_PROBE_TAKEN_;
                    }
                });
            });
        });
    }
    res.status(statusCode).end(JSON.stringify(ret));
});

/**
 * Someone is asking for capability(s)
 * We recognize the requester by its DN
 */
//app.get('/show/capability', function(req, res){
app.get(supervisor.SUPERVISOR_PATH_SHOW_CAPABILITY, function(req, res){
    var ret = {};//Here we put all the DNs for filtering specifications from
    var dn = DN(req);
    //__registered_capabilities__[DN][token]
    for (dn in __registered_capabilities__){
        for (label in __registered_capabilities__[dn]){
            if (!ret[dn])
                ret[dn] = [];
            // We add in meta some useful info
            var cap = new mplane.Capability(__registered_capabilities__[dn][label]);
            cap.set_metadata_value('eventTime' ,__registered_capabilities__[dn][label]['eventTime'] || "");
            ret[dn].push(JSON.parse(cap.to_dict()));
        }
    };
    res.send(JSON.stringify(ret));
});

/**
 * Someone is sending a result
 */
//app.post('/register/result', function(req, res){
app.post(supervisor.SUPERVISOR_PATH_REGISTER_RESULT, function(req, res){
    var result = mplane.from_dict(req.body)
        ,dn = DN(req)
        ,label = result.get_label()
        ,specHash = result.get_token();
    if (!(result instanceof mplane.Result)){
        res.status(403).send("mPlane error: not a result/wrong format ");
    }
    if (!__results__[dn])
        __results__[dn] = {};
    if (! __results__[dn][label])
        __results__[dn][label] = {};
    if (! __results__[dn][label][specHash])
        __results__[dn][label][specHash] = {};
    result['eventTime'] = new Date(); // Time we registered the result
    __results__[dn][label][specHash] = result;
    res.send("OK");
});

/**
 * Someone is asking for results WITH THE RI sequesce (reddem)
 */
app.post(supervisor.SUPERVISOR_PATH_SHOW_RESULT, function(req, res){
    var redeem = mplane.from_dict(req.body);
    if (!__sent_receipts__[redeem.get_token()]){
        res.status(403).send( "Unexpected redemption");
        return;
    }
    // Read from receipt index details for accessing results
    var dn = __sent_receipts__[redeem.get_token()].dn;
    var label = __sent_receipts__[redeem.get_token()].label;
    var specHash = __sent_receipts__[redeem.get_token()].specificationToken;
    if (!__results__[dn] || !__results__[dn][label] || !__results__[dn][label][specHash]){
        res.status(403).send("Unexpected redemption");
        return;
    }
    // If a result exists, send it else send the receipt
    // Delete the result from available ones
    if (__results__[dn][label][specHash]){
        res.send(new mplane.Result(__results__[dn][label][specHash]).to_dict());
        delete __results__[dn][label][specHash];
    }else{
        res.send(new mplane.Receipt(__required_specifications__[dn][label][specHash]).to_dict());
    }
});


//app.get('/info/', function(req , res){
app.get(supervisor.SUPERVISOR_PATH_INFO, function(req , res){
    supervisorInfo(null , res);
});
/*
app.get('/info/:itemType', function(req , res){
    supervisorInfo(req.itemType , res);
});
*/


//====================================================================================================================

/**
 * Checks if a capability for a DN is already registered
 * @param capability
 * @param DN Distinguisched name
 * @returns {boolean}
 */
function capabilityAlreadyRegistered(capability , DN){
    if ((__registered_capabilities__[DN]) && (__registered_capabilities__[DN][capability.get_label()])){
        return true;
    }
    return false;
}

/*
 registerCapability
 Register a new capability for a specific DN
 @param the mPlane capability object to be registered
 @param DN the DN
 */
function registerCapability(capability , DN){
    var token = capability.get_label();
    if (!__registered_capabilities__[DN])
        __registered_capabilities__[DN] = {};
    if (!__registered_capabilities__[DN][token]){
        __registered_capabilities__[DN][token] = capability;
        __registered_capabilities__[DN][token]['eventTime'] = new Date(); // The time we registered the capability
    }
    return token;
}


// ---------------------------------------------------------------
// Start the prompt
// ---------------------------------------------------------------
motd(function(){console.log("Supervisor listening on "+configuration.main.hostName+"@"+configuration.main.listenPort);});
if (configuration.main.cli)
    cli();

var prompt;

function cli(){
    var prompt = "mPlane - "+configuration.main.hostName+"@"+configuration.main.listenPort+"#";
    var questions = [
        {
            type: "list",
            name: "cmd",
            message: prompt,
            choices: [ "Show", "Specifications" , new inquirer.Separator() , "Quit" ],
            filter: function( val ) { return val.toLowerCase(); }
        },
            {
                type: "list",
                name: "showType",
                message: prompt+" (SHOW) ",
                choices: [ "Capabilities", "Specifications" , "Results"],
                when: function(curCmd){ return (curCmd.cmd == "show");},
                filter: function( val ) { return val.toLowerCase(); }
            },
            {
                type: "list",
                name: "cmd",
                message: "..."+prompt+"(SPECIFICATION)",
                choices: ["Define new specification" ,  "Delete a specification" , new inquirer.Separator() , "Done" ],
                when: function(curCmd){return (curCmd.cmd == "specifications");},
                filter: function( val ) { return val.toLowerCase(); }
            },
            {
                type: "list",
                name: "dn",
                message:  "..."+prompt+"(Registered Distinguished names)",
                choices: function(){
                    var h = _.keys(__registered_capabilities__);
                    if (h.length == 0)
                        return ["-- No dn yet --"];
                    else
                        return h;
                },
                when: function(curCmd){return ((curCmd.cmd == "define new specification") || (curCmd.cmd == "delete a specification"));}
            }, {
                type: "list",
                name: "capability",
                message:  "..."+prompt+"(CAPABILITIES)",
                choices: function(el){
                    var h = _.keys(__registered_capabilities__[el.dn]);
                    if (h.length == 0)
                        return ["-- No capabilities yet --"];
                    else
                        return h;
                },
                when: function(el){return(el.dn);}
            },
            {
                 type: "confirm",
                 name: "confirm_delete_specification",
                 message: "This will delete the specification. Are you sure?",
                 when: function(curCmd){return ((curCmd.cmd == "delete a specification"));},
                 filter: function( val ) { return val.toLowerCase(); }
            }

    ];

    inquirer.prompt( questions, function( answers ) {
        switch (answers.cmd){
            case "quit":
                console.log("\nSEE YOU NEXT TIME!\n\n");
                httpsServer.close();
                return false;
                break;
            case "show":
                doShow(answers.showType);
                console.log("\n\n");
                cli();
                break;
            case "define new specification":
                if ((answers.dn == "-- No dn yet --") || (answers.capability == '-- No capabilities yet --')){
                    answers.dn = null;
                    cli();
                    break;
                }else{
                    console.log(answers);
                    // If all params have been chosen, go on
                    if (answers.dn && answers.capability){
                        queueSpecification(answers.capability , answers.dn);
                        console.log("\n\n");
                    }
                }

                break;
            case "delete a specification":
                if (answers.capability == "-- no capabilities yet --"){
                    cli();
                    break;
                }else{
                    if (answers.delete_specification)
                        deleteSpecification(answers.capability);
                    else
                        cli();
                }
                break;
            default:
                  console.log(answers)
        }
    });
}


function doShow(args){
    switch (args.toLowerCase()){
        case "capabilities":
            if (_.keys(__registered_capabilities__).length == 0){
                console.log("---> NO DN registered YET <---");
                return true;
            }
            _.forEach(__registered_capabilities__ , function(index , DN , collection){
                console.log("-----------------------------------------------------------");
                console.log("---> ["+DN+"] <---");
                    _.forEach( __registered_capabilities__[DN] , function(index , token){
                        console.log("     ---> ["+token+"] <---");
                        console.log(prettyjson.render(__registered_capabilities__[DN][token]));
                    });
               });
            return true;
            break;
        case "specifications":
            if (_.keys(__required_specifications__).length == 0){
                console.log("---> NO specification queued <---");
                return true;
            }else{
                showSpecifications();
                return true;
            }
            break;
        case "results":
            if (_.keys(__results__).length == 0){
                console.log("---> NO results available <---");
                return true;
            }else{
                showResults();
                return true;
            }
            break;
        default:
            return true;
    }

    return true;
}

/**
 * Adds a Specification to the internal db
 * @param capabilityHash hash of the capability we want to add a specification to
 * @param DN DN of the element
 */
function queueSpecification(capabilityHash , DN){
    if (typeof  capabilityHash == "undefined"){
        console.log("You should choose a capability");
        return false;
    }
    if (!__required_specifications__[DN])
        __required_specifications__[DN] = {}; // We can have multiple request for a single DN
    if (!__required_specifications__[DN][capabilityHash])
        __required_specifications__[DN][capabilityHash] = {}; // We can have multiple request for a single capability on a DN
    // The specification is created from the registered capability
    var spec = new mplane.Specification(__registered_capabilities__[DN][capabilityHash]);

    var inputParams = [ ];
    var paramNames = spec.parameter_names();

    var msg = "";
    var defaultValue = "";
    var parameters = spec.getAllParameters();
    _.forEach(parameters , function(par){
        var constr = par.getConstraints();
        var pn = par.getName().replace(/\s/gi , "_");
        // If we have no constraints, we want at least to check that the value is valid with respect to the primitive of the parameter
		var validateFunc = function(value){return (par.isValid(value))};
		msg = par.getDescription() ;
		// We can have 0 constraints
		if (_.keys(constr).length > 0){
            var constraint = new mplane.Constraints(constr['0']);
            switch (constraint.getType()){
	            case mplane.Constraints.SINGLETON:
	                defaultValue = constraint.getParam();
	                break;
	            case mplane.Constraints.RANGE:
	                defaultValue = constraint.getValA();
	                break;
	            case mplane.Constraints.LIST:
	                defaultValue = constraint.getParam()[0];
	                break;
	            default:
	        }
          	msg += " [" + constraint.unParse_constraint()+"]";
			validateFunc = function(value){return ((par.isValid(value) && par.met_by(value , undefined)));};
		}
        inputParams.push(
            {
                type: "input",
                name: pn,
                message: msg || "TBD",
                validate: validateFunc,
                default:defaultValue
            }
        )
    });

    // New prompt for input about parameters to be filled
    var paramsCli = inquirer.prompt( inputParams, function( userParams ) {
        // Do not confuse the name of the parameter in the specification parameters obj with the parameter name in the parameter itself!
        for (var parNum=0 ; parNum<paramNames.length ; parNum++) {
            par = parameters[parNum];
            try {
                var parName = par.getName();
                spec.setParameterValue(paramNames[parNum], userParams[parName.replace(/\s/gi, "_")]);
                spec.specification_status = __SPEC_STATUS_QUEUED_;
            } catch (e) {
                console.log(e)
            }
        }
        var specToken = spec.update_token();

        __required_specifications__[DN][capabilityHash][specToken]= {};
        __required_specifications__[DN][capabilityHash][specToken]= spec;
        console.log("Specification for "+capabilityHash+"@"+DN+" QUEUED ("+specToken+")");
        cli();
    });
}

function deleteSpecification( specToken){
    //FIXME: per adesso mi baso sul fatto che è praticamente impossibile che 2 specification abbiano lo stesso token
    //      Occorrerebbe passare anche l'hash della capability
    _.forEach(_.keys(__required_specifications__) , function(capHash){
        _.forEach(_.keys(__required_specifications__[capHash]) , function(specHash){
        })
    });
    if (__required_specifications__[capabilityHash][specToken])
        delete __required_specifications__[capabilityHash][specToken];
}

/**
 * Show queued specifications
 * @param capabilityHash
 * @param DN
 * @returns {boolean}
 */
function showSpecifications(capabilityHash , DN){
    if (_.keys(__registered_capabilities__).length == 0){
        console.log("---> NO DN registered YET <---");
        return true;
    }

    // Are we asking for a specific capability or for all capabilities?
    if (!_.isUndefined(capabilityHash)){
        _.forEach(__registered_capabilities__[DN] , function(DN) {
            showSpecificationForCapability(capabilityHash , DN);
        });
    }
    else{
        var hashes = _.keys(__registered_capabilities__[DN]);
        _.forEach(hashes , function(hash){
            if (__required_specifications__[hash]){
                showSpecificationForCapability(hash);
                console.log( "\n");
            }
        });

        return true;
    }
}

/**
 * Show queued specifications
 * @param specificationHash
 * @returns {boolean}
 */
function showResults(capabilityHash , DN){
    if (_.keys(__registered_capabilities__).length == 0){
        console.log("---> NO DN registered YET <---");
        return true;
    }
    if (_.keys(__results__).length == 0){
        console.log("---> NO results available <---");
        return true;
    }

    // Are we asking for a specific capability or for all capabilities?
    if (!_.isUndefined(capabilityHash)){
        _.forEach(__registered_capabilities__[DN] , function(hash) {
            showResultForCapability(hash);
        });
    }
    else{
        var hashes = _.keys(__registered_capabilities__[DN]);
        _.forEach(hashes , function(hash){
            if (__results__[hash]){
                showResultForCapability(hash);
                console.log( "\n");
            }
        });

        return true;
    }
}

function showSpecificationForCapability(probeHash){
    console.log("+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++");
    console.log("Queued specification for "+probeHash);
    var specHashes = _.keys(__required_specifications__[probeHash]);
    for (var specNum=0 ; specNum<specHashes.length ; specNum++){
        var specToken = specHashes[specNum];
        console.log("------> Specification "+specToken+" <-------");
        console.log(prettyjson.render(new mplane.Specification( __required_specifications__[probeHash][specToken])));
        // We added a specification_status that is of significance only for the supervisor, so it is not considered by the mPlane lib
        console.log("---> STATUS: "+  __required_specifications__[probeHash][specToken].specification_status +" <---");
    }
    console.log("+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++");
}

function showResultForCapability(probeHash){
    console.log("+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++");
    // FIXME: mostrare anche la specifica!
    console.log("Results for "+probeHash);
    var resultHashes = _.keys(__results__[probeHash]);
    for (var resNum=0 ; resNum<resultHashes.length ; resNum++){
        var resToken = resultHashes[resNum];
        console.log("------> Result "+resToken+" <-------");
        console.log(prettyjson.render(new mplane.Result( __results__[probeHash][resToken])));
    }
    console.log("+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++");
}

function help(){
    console.log("SHOW probes");
    console.log("HELP");
}


/**
 * * Info about this supervisor
 * If not item is specified, all info are sent back
 * TODO: implement the item filter
 * @param item
 * @param res
 */
function supervisorInfo(item , res){
    var ret = {};
    ret['node'] = process.versions;
    ret.pid = process.pid;
    ret.platform = process.platform;
    ret.arch = process.arch;
    ret.memory = process.memoryUsage();
    ret.upTime = process.uptime();

    res.send(JSON.stringify(ret));
}

/**
 * Given a request obj, returns, if available, the distinguised Name or null
 * @param req
 * @returns {null}
 * @constructor
 */
function DN(req){
    if (!req)
        return null;
    var details = req.connection.getPeerCertificate() || null;
    if (!details)
        return null;
   // Extract the DNS altName
   var altName = details.subjectaltname.split(":"); 
   return(altName[1])
}

function motd(callback){
        console.log();
        console.log();
	console.log("    ###########################################");
	console.log("    ###$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$##");
	console.log("    ##$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$##");
	console.log("    ##$$$$$$$$$$$$$      $$$$$$$$$$$$$$$$$$$$##");
	console.log("    ##$$$$$$$$$$   ;$$$$   $$$$$$       $$$$$##");
	console.log("    ##$$$$$$$$   $$$$$$$$  $$$$   $$$$$  $$$$##");
	console.log("    ##$$$$$$   $$$$$$$$$$!      $$$$$$$   $$$##");
	console.log("    ##$$$$   $$$$$$$$$$$$$$  $$$$$$$$$$$  $$$##");
	console.log("    ##$$$  $$$$$$$$$$$$$$$$$$$$$$$$$$$$$  $$$##");
	console.log("    ##$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$##");
	console.log("    ###$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$##");
	console.log("    ###########################################");

        console.log();
        console.log("               mPlane supervisor DEMO");
        console.log();
        console.log("    An Intelligent Measurement Plane for Future \n         Network and Application Management");
        console.log();
        console.log();
        callback();
}
