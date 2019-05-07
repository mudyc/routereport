'use strict';

const querystring = require('querystring')
const https = require('https')
const bl = require('bl')
const { URL } = require('url')

// these come from aws
const AWS = require('aws-sdk')
const dynamo = new AWS.DynamoDB.DocumentClient()
const s3 = new AWS.S3()

const removeEmpty = (obj) =>
    Object.keys(obj)
    .filter(k => obj[k] !== null && obj[k] !== undefined && obj[k] !== '')  // Remove undef. and null and ''.
    .reduce((newObj, k) =>
            typeof obj[k] === 'object' ?
            Object.assign(newObj, {[k]: removeEmpty(obj[k])}) :  // Recurse.
            Object.assign(newObj, {[k]: obj[k]}),  // Copy value.
            {})

const token = event => event.headers.Cookie.split(';')[0].split('=')[1]

const hasObject = async (key) => {
  try {
    await s3.headObject({
      Bucket: process.env.reportsBucket,
      Key: key
    }).promise()
    return true
  } catch (headErr) {
    if (headErr.code === 'NotFound') {
      return false
    }
    throw headErr
  }
}

const putObjectS3 = async (key, object) => {
    return s3.putObject({
      Bucket: process.env.reportsBucket,
      Key: key,
      Body: JSON.stringify(object),
      ContentType: 'application/json'
    }).promise()
}

const httpsGet = async (url, headers) => {
    url = new URL(url)
    const options = {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: 'GET',
        headers: headers
    }
    console.log('opts', JSON.stringify(options))
    return new Promise((resolve, reject) => {
        const req = https.request(options, (response) => {
            console.log('statusCode:', response.statusCode)
            console.log('headers:', response.headers)

            response.setEncoding('utf8')
            response.pipe(bl((err, data) => {
                if (err) {
                    reject(err)
                }
                resolve(JSON.parse(data.toString()))
            }))
        });

        req.on('error', (e) => {
            reject(e)
        })
        req.end()
    })
}


const httpsPost = async (url, params) => {
    url = new URL(url)
    const postData = querystring.stringify(params)
    const options = {
        hostname: url.hostname,
        path: url.pathname,
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': postData.length
        }
    }

    return new Promise((resolve, reject) => {
        const req = https.request(options, (response) => {
            console.log('statusCode:', response.statusCode)
            console.log('headers:', response.headers)

            response.setEncoding('utf8')
            response.pipe(bl((err, data) => {
                if (err) {
                    reject(err)
                }
                resolve(JSON.parse(data.toString()))
            }))
        });

        req.on('error', (e) => {
            reject(e)
        })

        req.write(postData)
        req.end()
    })
}

const handleAuthCallback = async (event) => {
    const code = event.queryStringParameters.code
    //const resp = await httpsGet('')

    const client_secret = process.env.client_secret
    const client_id = process.env.client_id
    const grant_type = "authorization_code"

    const rep = await httpsPost('https://www.strava.com/oauth/token', {
        client_id, client_secret, code, grant_type
    })

    try { // is existing customer
        await dynamo.get({
            TableName : process.env.dynamoTable,
            Key: { userId: rep.athlete.username }
        }).promise()

        await dynamo.put({
            TableName : process.env.dynamoTable,
            Key: { userId: rep.athlete.username },
            UpdateExpression: 'set #a = :a',
            ExpressionAttributeNames: {'#a' : 'userId'},
            ExpressionAttributeValues: {':a' : rep.access_token}
        }).promise()

    } catch (err) { // new user
        console.log('new user', JSON.stringify(err))

        const data = {
            userId: rep.athlete.username,
            token: rep.access_token,
            athlete: rep.athlete,
            reportsLeft: 3,
            reportsCreated: 0,
        }
        await dynamo.put({
            TableName : process.env.dynamoTable,
            Item: removeEmpty(data)
        }).promise()
    }
    
    let response = {
        statusCode: 303,
        body: '',
        headers: {
            'Set-Cookie': 'token='+rep.access_token+'; Domain=.routereport.cf; Secure',
            Location: 'https://routereport.cf/#/select',
            'cache-control': 'no-store'
        }
    };
    console.log("response: " + JSON.stringify(response))
    return response
}

const handleSelect = async (event) => {
    console.log('handle select', event)
    const year = parseInt(event.queryStringParameters.year)
    const month = parseInt(event.queryStringParameters.month)
    const t0 = new Date(year, month)
    let t1 = null
    if (t0.getMonth() == 11) {
        t1 = new Date(t0.getFullYear() + 1, 0, 1)
    } else {
        t1 = new Date(t0.getFullYear(), t0.getMonth() + 1, 1)
    }

    console.log(t0, t1)
    const epoch = time => Math.round(time.getTime() / 1000)

    try {
        const acts = await httpsGet(`https://www.strava.com/api/v3/athlete/activities?after=${epoch(t0)}&before=${epoch(t1)}=&per_page=150`,
          { Authorization: `Bearer ${token(event)}`})

        return {
            statusCode: 200,
            body: JSON.stringify(acts),
            headers: {
                'Content-Type': 'application/json'
            }
        }
    } catch (err) {
        console.log('e', err)
        return {
            statusCode: 403,
            body: err
        }
    }
}

const handleCreateReport = async event => {
    
    const id = event.pathParameters.id
    const created = await hasObject(`activities/${id}/data.json`)
    if (created) // we can go to editthe report
        return {
            statusCode: 200,
            body: JSON.stringify({ created: true })
        }

    // who is this guy anyway?
    const user = await dynamo.query({
            TableName : process.env.dynamoTable,
            IndexName: 'token2userId',
            KeyConditionExpression: "#token=:con",
            ExpressionAttributeValues: { ":con" : token(event) },
            ExpressionAttributeNames: { "#token" : 'token' }
        }).promise()
    if (user.Count !== 1)
        return {
            statusCode: 403,
            body: ''
        }

    // read userdata by userId
    const userData = await dynamo.get({
        TableName: process.env.dynamoTable,
        Key: { userId: user.Items[0].userId }
    }).promise()
    console.log('userdata', userData)
    if (userData.Item.reportsLeft > 0) {

        const data = await httpsGet(`https://www.strava.com/api/v3/activities/${id}/streams?keys=latlng,altitude,time,moving,velocity_smooth,heartrate`,
          { Authorization: `Bearer ${token(event)}`})
        await putObjectS3(`activities/${id}/data.json`, data)

        const activity = await httpsGet(`https://www.strava.com/api/v3/activities/${id}`,
          { Authorization: `Bearer ${token(event)}`})
        await putObjectS3(`activities/${id}/activity.json`, activity)

        await putObjectS3(`activities/${id}/report.json`, {})

        await dynamo.update({
            TableName : process.env.dynamoTable,
            Key: { userId: userData.Item.athlete.username },
            UpdateExpression: 'ADD reportsLeft :dec, reportsCreated :inc',
            ExpressionAttributeValues: {':dec': -1, ':inc': 1}
        }).promise()
        return {
            statusCode: 201,
            body: JSON.stringify({ created: true })
        }
    } else {
        return {
            statusCode: 200,
            body: JSON.stringify({ created: false, buy: true })
        }
    }
}

exports.handler = async (event) => {
    console.log("request: " + JSON.stringify(event));
    // event path(=resource)
    const routing = {
        '/strava/callback': handleAuthCallback,
        '/strava/selection': handleSelect,
        '/strava/create/{id}': handleCreateReport,
    }
    const reply = await routing[event.resource](event)
    reply.headers = reply.headers || {}
    reply.headers['Access-Control-Allow-Origin'] = event.headers.origin || event.headers.Origin
    reply.headers['Access-Control-Allow-Credentials'] = true
    console.log('out', JSON.stringify(reply))
    return reply
};
