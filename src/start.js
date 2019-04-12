var sql = require("mssql");
const tf =require( "@tensorflow/tfjs");

// config for your database
var config = {
    user: 'hack17',
    password: 'd6yBewvpT4!',
    server: '192.168.250.3',
    database: 'hackathon_danone'
};

async function fillWithData(orderId, bigbag, dd, slurry, outSemi, outTest, input, label) {
    let walec = await runQuery(`SELECT TOP 1000  *, CAST(CONVERT(datetime,walec08.timestamp) as float) as time from recipe_0_orders_details
       JOIN "Walec DD08" walec08 ON walec08.timestamp between recipe_0_orders_details.activation_date  AND recipe_0_orders_details.closing_date
       where id = ${orderId}`);

    for (let row of walec.recordset) {
        row.bigbag = findNearest(bigbag.recordset, row.time)
        row.dd = findNearest(dd.recordset, row.time)
        row.slurry = findNearest(slurry.recordset, row.time)
        row.outSemi = findNearest(outSemi.recordset, row.time)
        row.outTest = findNearest(outTest.recordset, row.time)

        input.push([row.steam_pressure_at_the_inlet_of_regulation_unit, row.product_temperature_at_the_outlet_of_JetCooker]);
        label.push([row.outSemi.efficiency, row.outTest.moisture, row.outTest.bulk_density]);
    }
}

// connect to your database
sql.connect(config, async function (err) {
const orderId=1;
    if (err) console.log(err);

    // create Request object


   // let raw_material = await runQuery(`select *
   //     from recipe_0_raw_material_in raw_in
   //     join recipe_0_raw_material_used  raw_used ON raw_used.process_order_sap3 = raw_in.process_order_sap3 AND raw_used.id=raw_in.id
   //     ORDER BY `);
    let bigbag=await runQuery(`SELECT *, CAST(CONVERT(datetime,bigbag_filling_time_end) as float) as time FROM recipe_0_processing_details_bigbag WHERE orders_details_id = ${orderId} ORDER BY bigbag_filling_time_end`);
    let dd=await runQuery(`SELECT *, CAST(CONVERT(datetime,testing_time) as float) as time FROM recipe_0_processing_details_dd WHERE orders_details_id = ${orderId} ORDER BY testing_time`);
    let slurry=await runQuery(`SELECT *, CAST(CONVERT(datetime,slurry_start_time) as float) as time FROM recipe_0_processing_details_slurry WHERE orders_details_id = ${orderId} ORDER BY slurry_start_time`);
    let outSemi=await runQuery(`SELECT *, CAST(CONVERT(datetime,bigbag_filling_time_end) as float) as time FROM recipe_0_out_semi_finished_production WHERE orders_details_id = ${orderId} ORDER BY bigbag_filling_time_end`);
    let outTest=await runQuery(`SELECT *, CAST(CONVERT(datetime,testing_time) as float) as time FROM recipe_0_out_test_during_production WHERE orders_details_id = ${orderId} ORDER BY testing_time`);

    let input=[];
    let label=[];
    let orders=await runQuery("SELECT TOP 5 * from recipe_0_orders_details WHERE data_split = 'training'");
    for(let order of orders.recordset) {
        await fillWithData(order.id, bigbag, dd, slurry, outSemi, outTest, input, label);
    }
let tensor=convertToTensor(input, label);
    let model=createModel();
   let trainResult= await trainModel(model, tensor.inputs, tensor.labels);
    console.log('Done Training');
    let ordersTest=await runQuery("SELECT * from recipe_0_orders_details WHERE data_split = 'test'");
    let inputTest=[];
    let labelTest=[];
    for(let order of ordersTest.recordset) {
        await fillWithData(order.id, bigbag, dd, slurry, outSemi, outTest, inputTest, labelTest);
    }
    testModel(model, inputTest, labelTest, tensor);
   console.log(tensor);
});


function findNearest(data, value){
    let result=null;
    let distance=Number.POSITIVE_INFINITY;
    for(let x of data ){
        if(Math.abs(x.time - value)<distance){
            distance=Math.abs(x.time - value);
        result=x;
        }
    }
    return result;
}
function runQuery(query){
    return new Promise((resolve,reject)=>{
        var request = new sql.Request();
        request.query(query, function (err, recordset) {
            if(err) reject(err);
            else resolve(recordset);
        });

    })
}
function convertToTensor(input,label) {
    // Wrapping these calculations in a tidy will dispose any
    // intermediate tensors.

    return tf.tidy(() => {
        // Step 1. Shuffle the data
       // tf.util.shuffle(data);

        // Step 2. Convert data to Tensor

        const inputTensor = tf.tensor2d(input, [input.length, input[0].length]);
        const labelTensor = tf.tensor2d(label, [label.length, label[0].length]);

        //Step 3. Normalize the data to the range 0 - 1 using min-max scaling
        const inputMax = inputTensor.max();
        const inputMin = inputTensor.min();
        const labelMax = labelTensor.max();
        const labelMin = labelTensor.min();

       // const normalizedInputs = inputTensor.sub(inputMin).div(inputMax.sub(inputMin));
       // const normalizedLabels = labelTensor.sub(labelMin).div(labelMax.sub(labelMin));

        return {
            inputs: inputTensor,
            labels: labelTensor,
            // Return the min/max bounds so we can use them later.
            inputMax,
            inputMin,
            labelMax,
            labelMin,
        }
    });
}
function createModel() {
    // Create a sequential model
    const model = tf.sequential();

    model.add(tf.layers.dense({inputShape: [2], units: 2, useBias: true}));

    model.add(tf.layers.dense({units: 6, useBias: true}));

    model.add(tf.layers.dense({units: 3, useBias: true}));

    return model;
}
async function trainModel(model, inputs, labels) {
    // Prepare the model for training.
    model.compile({
        optimizer: tf.train.adam(),
        loss: tf.losses.meanSquaredError,
        metrics: ['mse'],
    });

    const batchSize = 28;
    const epochs = 2;

    return await model.fit(inputs, labels, {
        batchSize,
        epochs,
        shuffle: true,
        callbacks: console.log
    });
}
function testModel(model, inputs, labels, normalizationData) {
    const {inputMax, inputMin, labelMin, labelMax} = normalizationData;

    // Generate predictions for a uniform range of numbers between 0 and 1;
    // We un-normalize the data by doing the inverse of the min-max scaling
    // that we did earlier.
    const [ preds] = tf.tidy(() => {

        const preds = model.predict(tf.tensor2d(inputs[0],[1,2]));


        // Un-normalize the data
        return [ preds.dataSync()];
    });


console.log(inputs[0],labels[0], preds);





}