/**
 *  mPlane supervisor remote CLI
 *  The interaction with the supervisor in NOT MPLANE compliant. The supervisor simply sends a copy of its internal data structures.
 *
 * Created by Fabrizio Invernizzi on 11/08/2014.
 */

var http = require("http")
    ,Ascii = require('ascii')
    ,cli = require('cli').enable('status','catchall','version','help')
    ,StateMachine = require("javascript-state-machine")
    ,_ = require('lodash')
    ,mplane = require('mplane')
    ,Table = require('cli-table')
    ,fs = require("fs")
    ,inquirer =require("inquirer")
    ,async = require("async")
    ,supervisor = require("mplane_http_transport");

var CONFIGFILE = "client.json";
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

// Load the reference registry
mplane.Element.initialize_registry(configuration.registry.file);

// This will held the prompt msg
var PROMPT_MSG = "";

cli.setApp(configuration.main.description , configuration.main.version );

// Autocomplete definitions.
// TODO: It would be better to use this same object to build the state transitions...
var supervisorOptions = ["capabilities" ,  "specifications" , "results"]; // Directly used in show

// Here we keep unRedeemed specifications receipts
var __specification_receipts__ = [];

/***************************
 * CLI finite State Machine
 ****************************/
var fsm = StateMachine.create({
    initial: 'start',
    events: [
        { name: 'exitE',  from: ['*'],  to: 'done' },
        { name: 'setE', from: 'start', to: 'set'},
        { name: 'showE', from: ['*'], to: 'show'},
        { name: 'startE', from: ['*'], to: 'start'},
        { name: 'requireE', from: 'start', to: 'require'},
        { name: 'infoE', from: 'show', to: 'info'},
        { name: 'helpE', from: ['*'], to: 'help'}
    ],
    callbacks: {
        onstartE:  function(event, from, to, msg) {
            // Reset
            inquirer.answers = {};
            inquirerCli();
        },
        onexitE:  function(event, from, to, msg) {
            cli.info("See YOU!"); cli.exit();
        },
        onshowE:  function(event, from, to, msg) {
            manageShowState(event, from, to, msg);
        },
        onsetE:  function(event, from, to, msg) {
            manageSetState(event, from, to, msg);
        },
        oninfoE:  function(event, from, to, msg) {
            manageInfoState(event, from, to, msg);
        },
        onrequireE:  function(event, from, to, msg) {
            manageRegisterState(event, from, to, msg);
        },
        onhelpE:  function(event, from, to, msg) {help(event, from, to, msg); }
    }
});

// ------------------------------------------------------------------------------------

// CLI params
cli.parse({
    supervisorHost:  ['b', 'Supervisor address', 'ip', 'mplane.org'],
    supervisorPort:  ['p', 'Supervisor port', 'int', '2427'],
    SSL:['s', 'Use SSL in supervisor connections', 'bool', true],
    ca:['c' , 'Certificate file of the Certification Auth' , 'string' , configuration.ssl.ca],
    key:['k' , 'Key file of the client' , 'string' , configuration.ssl.key],
    cert:['t' , 'Certificate file of the client' , 'string' , configuration.ssl.cert],
    user:['u' , 'Login as user' , 'string' , 'demo']
});
if (process.stdout.columns < configuration.main.minimum_columns_required)
    cli.info("CONSIDER CHANGE THE TERMINAL COLUMNS NUMBER ("+configuration.main.minimum_columns_required+" suggested)");


var PROMPT_MSG = cli.options.user+"@"+cli.options.supervisorHost+":"+cli.options.supervisorPort;
var inquirerQuestions = [
    {
        type: "list",
        name: "cmd",
        message: PROMPT_MSG,
        choices: [ "Show", "Register" , new inquirer.Separator() , "Quit" ]
    }
];

function inquirerCli(){
    inquirer.prompt(inquirerQuestions, function( answers ){
        switch (answers.cmd){
            case "Show":
                fsm.showE();
                break;
            case "Register":
                fsm.requireE();
                break;
            case "Quit":
                fsm.exitE();
                break;
            default:
                console.log("UNDEF COM");
                console.log(answers);

        }
    });

}
//*******************************************
// Let's go!
motd(function(){fsm.startE()});
//*******************************************

//*****************************************************************************************************************

/******************************
 *  STATE MANAGEMENT FUNCTIONS
 *****************************/

/**
 * Manages the set state. In this state user can change client params
 * @param event
 * @param from
 * @param to
 * @param input array of input from user. Input[0] is the "set" keyword
 */
function manageSetState(event, from, to, input){
    //Checks that a param has been given
    if (input.length < 3){
        showParams();
        fsm.startE();
    }else{
        if (!_.contains(_.keys(cli.options), input[1]) ){
            cli.prompt("Invalid parameter "+input[1]);
        }else{
            cli.options[input[1]] = input[2];
            PROMPT_MSG = cli.options.supervisorHost+":"+cli.options.supervisorPort;
            showParams();
        }
        fsm.startE();
    }
}
/**
 * Shows the supervisor information
 * @param event
 * @param from
 * @param to
 * @param input
 */
function manageInfoState(event, from, to, input){
    console.log(cli.options.supervisorHost);
    console.log(cli.options.supervisorPort);
    console.log(cli.options.ca);
    console.log(cli.options.key);
    console.log(cli.options.cert);

    supervisor.info({
        host: cli.options.supervisorHost,
        port: cli.options.supervisorPort,
        caFile : cli.options.ca,
        keyFile : cli.options.key,
        certFile : cli.options.cert
    } , function(err , data){
        if (!err){
            showTitle("Supervisor information");
            console.log(data);
        }else{
            cli.error("Error connecting to the supervisor:"+err.toString());
        }
        fsm.startE();
    });
}

/**
 * Require state.
 * @param event
 * @param from
 * @param to
 * @param input
 */
function manageRegisterState(event, from, to, input) {
    var inquirerRequireQuestions = [
        {
            type: "list",
            name: "requireType",
            message: PROMPT_MSG+" ( select a REQUIRE option) ",
            choices: [ "Capabilities", "Specifications" , "Results" , new inquirer.Separator() , "Done"]
        }
    ];

    inquirer.prompt(inquirerRequireQuestions, function( answers ){
        switch (answers.requireType){
            case "Capabilities":
                showTitle("Not implemented");
                fsm.startE();
                break;
            case "Specifications":
                var DN = "";
                showSupervisorCapabilityes(function(err , capabilities){
                if (err){
                    showTitle("Error comunicating with supervisor"+err.toString());
                    fsm.startE();
                }else{
                    // If nothing is registered, stop
                    if (_.keys(capabilities).length == 0){
                        showTitle("No DN registered");
                        fsm.startE();
                        return;
                    }
                    var inquirerDNRequire = [
                        {
                            type: "list",
                            name: "DNinRequire",
                            message: PROMPT_MSG+" ( select a system) ",
                            choices: function(){
                                var h = _.keys(capabilities);
                                if (h.length == 0){
                                    return [];
                                }
                                else{
                                    h.push( "Done");
                                    return h;
                                }

                            }
                        }
                    ];
                        inquirer.prompt(inquirerDNRequire, function( answers ){
                            if (answers.DNinRequire == "Done"){
                                fsm.startE();
                            }else{
                                var inquirerCapabilitiesRequire = [
                                    {
                                        type: "list",
                                        name: "capabilityinRequire",
                                        message: PROMPT_MSG+" ( select a capability for "+answers.DNinRequire+")",
                                        choices: function(){
                                            var h = [];
                                            DN = answers.DNinRequire;
                                            capabilities[DN].forEach(function(val, index){
                                                var c = new mplane.Capability(val);
                                                h.push({name: c.get_label(), value:index});
                                            });
                                            //var h = _.keys(capabilities[DN]);
                                            if (h.length == 0){
                                                return ["-- No capability registered for "+DN+" --"];
                                            }
                                            else{
                                                h.push("Done");
                                                return h;
                                            }
                                        }
                                    }
                                ];
                                inquirer.prompt(inquirerCapabilitiesRequire, function( answers ){
                                    if (answers.capabilityinRequire == "Done"){
                                        fsm.startE();
                                    }else{
                                       // var capability = new mplane.Capability(capabilities[DN][answers.capabilityinRequire]);
                                        // Capabilities are stored by showSupervisorCapabilityes as they arrives, so in mplane format. We need to use from_dict
                                        var capability = mplane.from_dict(capabilities[DN][answers.capabilityinRequire]);
                                        requireSpecificationParameters(capability ,  function(err , parValues) {
                                            var spec = new mplane.Specification(capability);
                                            // FIXME: This is mandatory in RI! we don-t use it yet, so simply set a generic value
                                            spec.set_when("now + 1s");
                                            _.each(parValues, function (index, par) {
                                                spec.setParameterValue(par, parValues[par]);
                                            });
                                            supervisor.registerSpecification(spec
                                                ,DN
                                                ,{
                                                    host: cli.options.supervisorHost,
                                                    port: cli.options.supervisorPort,
                                                    keyFile: cli.options.key,
                                                    certFile: cli.options.cert,
                                                    caFile: cli.options.ca
                                                },
                                                function (err, receipt) {
                                                    if (err)
                                                        console.log(err);
                                                    else{
                                                        // Register the receipt
                                                        var rec = mplane.from_dict(JSON.parse(receipt));
                                                        rec._eventTime = new Date(); // Informational
                                                        // The RI does not set the label in the receipt
                                                        // Since we have it from the spec, simply set it in the receipt
                                                        rec.set_label(spec.get_label());
                                                        if (!(rec instanceof mplane.Receipt)){
                                                            cli.error("The returned message is not a valid Receipt");
                                                        }else{
                                                            // We keep local registry of all spec and relative receipts
                                                            rec._specification = spec;
                                                            __specification_receipts__.push(rec);
                                                        }
                                                    }
                                             });
                                             fsm.startE();
                                            })
                                    }
                                });
                            }
                        });
                    } // No error
                });
                break;
            case "Results":
                showTitle("Not implemented");
                fsm.startE();
                break;
            case "Done":
                fsm.startE();
                break;
            default:
                console.log("UNDEF require");
                console.log(answers);

        }
    });
}

function manageShowState(event, from, to, input){
    var inquirerShowQuestions = [
        {
            type: "list",
            name: "showType",
            message: PROMPT_MSG+" ( select a SHOW option) ",
            choices: [ "Capabilities", "Specifications" , "Results" , new inquirer.Separator() , "Supervisor Info" , new inquirer.Separator() , "Done"]
        }
    ];
    inquirer.prompt(inquirerShowQuestions, function( answers ){
        switch (answers.showType){
            case "Capabilities":
                showSupervisorCapabilityes(function(err, ret){fsm.startE();});
                break;
            case "Specifications":
                showSupervisorSpecifications(function(err , data){fsm.startE();});
                break;
            case "Results":
                showSupervisorResults(function(err , data){fsm.startE();});
                break;
            case "Supervisor Info":
                fsm.infoE();
                break;
            case "Done":
                fsm.startE();
                break;
            default:
                console.log("UNDEF show");
                console.log(answers);

        }
    });
}
/**
 * Requests all the capabilities registered on the supervisor and shows them in a table
 * @param callback the function to call on completion
 */
function showSupervisorCapabilityes(callback){
    supervisor.showCapabilities({
        caFile : cli.options.ca,
        keyFile : cli.options.key,
        certFile : cli.options.cert,
        host : cli.options.supervisorHost,
        port: cli.options.supervisorPort
    },
    function(error , caps){
        if (error){
            showTitle("Error connecting to the supervisor."+error.toString());
        }
        if (_.keys(caps).length == 0){
            showTitle("NO CAPABILITY registered on the supervisor");
        }else{
            var table = new Table({
                head: ['Registered' , 'Label', 'System type' , 'System' , 'Capability Type' , 'When' , 'Parameters' , 'Results']
            });
            _.keys(caps).forEach(function(DN){
                showTitle(DN);
                caps[DN].forEach(function(cap){
                    var capability = mplane.from_dict(cap);
                    table.push(
                        [capability.get_metadata_value('eventTime')|| "", capability.get_label() || "", capability.get_metadata_value('System_type') || "", capability.get_metadata_value('System_ID') || "",capability.get_verb() || "", capability.whenToString() || "", capability.getParameterNames().join('\n'), capability.result_column_names().join('\n') || ""]
                    );
                });
            });
            console.log(table.toString());
            console.log("\n\n");
        }
        callback(null, caps);
    });
}


/**
 * Requests all the specifications registered on the supervisor and shows them in a table
 */
function showSupervisorSpecifications(callback){
    supervisor.showSpecifications({
        host:cli.options.supervisorHost,
        port:cli.options.supervisorPort,
        caFile:cli.options.ca,
        keyFile:cli.options.key,
        certFile:cli.options.cert
    },
    function(error , specifications){
        if (!error) {
            if (_.keys(specifications).length == 0){
                showTitle("NO specifications registered on the supervisor");
                callback(null, null);
            }else {
                var table = new Table({
                    head: [ 'Registered' , 'Label', 'System type' , 'System' , 'Capability Type' , 'Parameters' , 'Value' ,'Status' ]
                });
                specifications.forEach(function(s) {
                    var curSpec = mplane.from_dict(s);
                    var values = [];
                    // For each parameter of each defined specification, push the values in the value array
                    (curSpec.parameter_names()).forEach(function (paramName) {
                        values.push(curSpec.get_parameter_value(paramName));
                    });
                    table.push(
                        [curSpec.get_metadata_value('eventTime') , curSpec.get_label(), curSpec.get_metadata_value('System_type') ,curSpec.get_metadata_value('System_ID'),curSpec.get_verb() , (curSpec.parameter_names()).join('\n') , values.join("\n"), curSpec.get_metadata_value('specification_status')]
                    );
                });
                showTitle("SPECIFICATIONS");
                console.log(table.toString());
                console.log();
                callback(null , null);
            }
        }//if (!error)
    });
}

/**
 * Reddems a soecific specification from the receipt
 */
function showSupervisorResults(callback){
    var post_options = {};
    // Shows known receipts. If no receipts are registerd, complete the action
    if (!showReceipts() || (__specification_receipts__.length == 0)){
        showTitle("--No Result ready")
        callback(null , null);
        return;//Just not to have an long else statement
    }
    // Select a Receipt to redeem
    var inquirerQuestions = [
        {
            type: "rawlist",
            name: "receipt",
            message: PROMPT_MSG,
            choices: function(answers){
                var r = [];
                __specification_receipts__.forEach(function(rec , index){
                    r.push({
                        key: (index*1 + 1).toString(),
                        name: rec._label,
                        value: index
                    });
                });
                return r;
            }
        }
    ];
    inquirer.prompt(inquirerQuestions, function( answers ){
        supervisor.showResults(new mplane.Redemption({receipt: __specification_receipts__[answers.receipt]}) , {
            host:cli.options.supervisorHost,
            port:cli.options.supervisorPort,
            ca:cli.options.ca,
            key:cli.options.key,
            cert:cli.options.cert
        },
        function(err , response){
            if (err){
                if (err.message == 403){
                    showTitle("Result not availbale yet");
                    callback(new Error("Result not availbale yet"),null);//Wrong answer
                    return;
                }else{
                    showTitle("Error:"+body);
                    callback(new Error("Error from server"),null);//Wrong answer
                    return;
                }
            }else{
                var result = mplane.from_dict(body);
                if (!(result instanceof mplane.Result)){
                    // The result is not ready
                    if (result instanceof mplane.Receipt){
                        showTitle("Not ready yet...");
                        callback(null,null);
                    }else
                        callback(new Error("Result expected"),null);//Wrong answer
                }else{
                    var table = new Table({
                        head: ['Registered' , 'Label', 'System type' , 'System' , 'Params' ,  'Result' , ' Result value']
                    });
                    var label = result.get_label() || "Unknown";
                    var resultColumn_names = result.result_column_names();
                    var values = [];
                    var params = [];
                    var registered = result.get_metadata_value('eventTime') || "Unknown";

                    // For each result of each defined specification, push the values and param specification in the value/param array.
                    // TODO: results have the when clause which can be exposed
                   // _.forEach(resultColumn_names , function(col,pos){values.push( parseFloat(result.get_result_column_values(col)) .toFixed(2));  });
                    _.forEach(resultColumn_names , function(col,pos){values.push(result.get_result_column_values(col));  });
                    _.forEach(result.parameter_names() , function(parName,pos){ params.push(parName+" : " + result.get_parameter_value(parName) ) });
                    table.push(
                        [registered , label, result.get_metadata_value('System_type') || "Unknown", result.get_metadata_value('System_ID') || "Unknown" , params.join('\n'), resultColumn_names.join('\n') , values.join("\n") ]
                    );
                    showTitle("RESULTS");
                    console.log(table.toString());
                    console.log();
                    callback(null,null);
                }//else
            }
        });
    });
}


// Ask for valid params for a capability, returns an obj with {param1:value , param2:value, ...}
function requireSpecificationParameters(capability, mainCallback){
    var ret={};
    parameters = capability.getAllParameters()

    async.eachSeries(parameters , function(par , callback){
        var constr = par.getConstraints();
        // If we have no constraints, we want at least to check that the value is valid with respect to the primitive of the parameter
        validateFunc = function(value){return ((par.isValid(value) && par.met_by(value , undefined)));};
        msg = par.getName() + " - "+par.getDescription();
            // We can have 0 constraints
            if (_.keys(constr).length > 0){
                var constraint = new mplane.Constraints(constr['0']);
                // If the constrain is a single value, do not prompt for it
                if (constraint.getType() == mplane.Constraints.SINGLETON){
                    ret[par.getName()]=constraint.getParam();
                    callback();
                }else{
                    switch (constraint.getType()){
                        case mplane.Constraints.SINGLETON:
                            ret[par.getName()]=constraint.getParam();
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
                    msg += " (" +mplane.Constraints.unParse_constraint(constraint)+") - ";
                    msg += " [" +defaultValue+"]";
                    validateFunc = function(value){return ((par.isValid(value) && par.met_by(value , undefined)));};

                    inquirer.prompt({
                        name:"param",
                        validate: validateFunc,
                        message: msg,
                        default:defaultValue
                    }, function(answers){
                        ret[par.getName()]=answers.param;
                        callback(); // Ok, this parameter is ok
                    });
                }
            }
    }
     ,function(){
            mainCallback(null , ret);
    });
}

// ------------------------------------------------------------------------------------------------------------------
//
//  Usefull functions
//
// ------------------------------------------------------------------------------------------------------------------

/**
 * Shows parameters
 */
function showParams(){
    var head = []
        , values = [];

    _.keys(cli.options).forEach(function (par) {head.push(par);values.push(cli.options[par])});

    var table = new Table({
        head: head
    });
    table.push(values );
    console.log(); // Needed to correctly align left the table
    console.log(table.toString());
    console.log();
}

// Show all registered receipts
function showReceipts(){
    if ( __specification_receipts__.length === 0){
        showTitle("NO RECEIPTS");
        return false;
    }

    var table = new Table({
        head: ['Registered' , 'Label', 'System type' , 'System' , 'Parameters'  ]
    });

    __specification_receipts__.forEach(function(receipt){
            var specification = new mplane.Specification(receipt._specification);
            var params_values = [];
            var registered = receipt['_eventTime'] ;
            // For each result of each defined specification, push the values and param specification in the value/param array.
            _.forEach(_.keys(specification["_params"]) , function(parmName,pos){ params_values.push(parmName+" : " + specification["_params"][parmName]['_value'] ) });
            table.push(
                [ registered || "Unknown", receipt._label || "Unknown", receipt["_metadata"]['System_type'] || "Unknown", receipt["_metadata"]['System_ID'] || "Unknown", params_values.join("\n")  ]
            );
    });
    showTitle("Pending RECEIPTS");
    console.log(table.toString());
    console.log();
    return true;
}


function motd(callback){
   //console.log('\033[2J');
    var pic = new Ascii('./images/mplane_final_short_256x.png');
    // output in terminal (terminal mode)
    pic.convert(function(err, result) {
        console.log();
        console.log(result);
        console.log();
        console.log("                   MPLANE ");
        console.log();
        console.log("An Intelligent Measurement Plane for Future \n     Network and Application Management");
        console.log();
        console.log(cli.app + " (" +cli.version + ")");
        console.log();
        console.log();
        callback();
    });
}

/**
 * Adds a prompt function to cli.
 *
 * @param txt
 */
cli.prompt = function(txt){
    pre = this.no_color ? txt : '\x1B[32m'+txt+'\x1B[0m';
    var msg = pre + ' ' + configuration.main.prompt_separator;
    process.stdout.write(msg);
}

var pad = function (str, len , padChar) {
    if (!padChar)
        padChar = " ";
    if (typeof len === 'undefined') {
        len = str;
        str = '';
    }
    if (str.length < len) {
        len -= str.length;
        while (len--) str += padChar;
    }
    return str;
};

// Utility function to show a title somehow formatted
function showTitle(text){
    console.log("\n\n"+pad("",text.length,"-"));
    console.log(text);
    console.log(pad("",text.length,"-")+"\n");
}

/**
 * Format a token to be shown.
 * @param token
 * @returns {string}
 */
function showToken(token){
    if (!token)
        token = "";
    // Only last part of the token
    return("..."+ token.slice(-6));
}

function clear()
{
    var stdout = "";

    var lines = process.stdout.getWindowSize()[1] -10 ;
    for (var i=0; i<lines; i++)
    {
        stdout += "\r\n";
    }
    // Reset cursur
    stdout += "\033[0f";

    process.stdout.write(stdout);
}