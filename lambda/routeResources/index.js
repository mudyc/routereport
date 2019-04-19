'use strict';
console.log('Loading hello world function');
 
exports.handler = async (event) => {
    console.log("request: " + JSON.stringify(event));
    
    let responseBody = {
        message: 'doh!',
        input: event
    };
    
    let response = {
        statusCode: 200,
        body: JSON.stringify(responseBody)
    };
    console.log("response: " + JSON.stringify(response))
    return response;
};
