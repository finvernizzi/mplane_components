/**
 * This module manages external CA or keys
 * It is simply a wrapper of basic FS functions
 *
 * @type {readCaChain}
 */

var fs = require('fs');

module.exports.readCaChain = readCaChain;
module.exports.readFileContent = readFileContent;

// Given an array of file name (complete path) or a single file (complete path), return an array of ca for use in https options
function readCaChain(caChain){
    var ret = [];
    if (caChain instanceof Array){
        caChain.forEach(function(fileName){
            try{
                ret.push(fs.readFileSync(fileName , "utf-8"))
            }catch(e){
                console.log("---readCaChain--- Error reading CA chain file");
                console.log(e);
                return null;
            }
        });
    }
    // IF it is a string, it should be directly a file name and not a chain
    if (caChain instanceof String){
        try{
            ret.push(fs.readFileSync(caChain) , "utf-8");
        }catch(e){
            console.log("---readCaChain--- Error reading CA chain file");
            console.log(e);
            return null;
        }
    }
    return ret;
}
// This is for reading cert and keys
function readFileContent(fileName){
    try{
        return(fs.readFileSync(fileName , "utf-8"));
    }catch(e){
        console.log("---readFileContent-- Error reading file "+fileName);
        console.log(e);
        return null;
    }
}