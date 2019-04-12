var sql = require("mssql");

// config for your database
var config = {
    user: 'hack17',
    password: 'd6yBewvpT4!',
    server: '192.168.250.3',
    database: 'hackathon_danone'
};

// connect to your database
sql.connect(config, function (err) {

    if (err) console.log(err);

    // create Request object
    var request = new sql.Request();

    // query to the database and get the records
    request.query('select * from recipe_0_orders_details', function (err, recordset) {

        if (err) console.log(err)

        // send records as a response
        console.log(recordset.recordset);

    });
});