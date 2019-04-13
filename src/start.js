var sql = require("mssql");
const tf = require("@tensorflow/tfjs-node");

// config for your database
var config = {
    user: 'hack17',
    password: 'd6yBewvpT4!',
    server: '192.168.250.3',
    database: 'hackathon_danone'
};

async function fillWithData(orderId, bigbag, dd, slurry, outSemi, outTest, input, label) {
    let walec = await runQuery(`SELECT *, CAST(CONVERT(datetime, walec08.timestamp) as float) as time
                                from recipe_0_orders_details
                                         JOIN "Walec DD08" walec08
                                              ON walec08.timestamp between recipe_0_orders_details.activation_date AND recipe_0_orders_details.closing_date
    where id = ${orderId}`);

    for (let row of walec.recordset) {
        row.bigbag = findNearest(bigbag.recordset, row.time)
        row.dd = findNearest(dd.recordset, row.time)
        row.slurry = findNearest(slurry.recordset, row.time)
        row.outSemi = findNearest(outSemi.recordset, row.time)
        row.outTest = findNearest(outTest.recordset, row.time)
        if (!row.bigbag || !row.dd || !row.slurry || !row.outSemi || !row.outTest)
            continue;
        let inputArray = [
            row.bigbag.bigbag_number,
            row.bigbag.sifter_speed_nominal_pct,

            row.dd.dd_speed,
            row.dd.steam_preasure,
            row.dd.temp_out,

            row.slurry.slurry_process_order,
            row.slurry.water_correction,
            //row.slurry.water_pct,//todo pomyśleć

            row.condensate_temperature_at_DD_outlet,
            // row.product_at_the_outlet_of_JetCooker,
            row.product_temperature_at_the_inlet,
            // row.product_temperature_at_the_outlet_of_product,
            //row.setpoint_of_product_temperature,//todo pomyśleć
            row.setpoint_of_steam_pressure_at_the_DD_inlet,

            row.steam_pressure_at_the_inlet_of_regulation_unit,
            row.product_temperature_at_the_outlet_of_JetCooker,
        ];
        let outputArray = [row.outSemi.efficiency, row.outTest.moisture, row.outTest.bulk_density];

        input.push(inputArray);
        label.push(outputArray);
    }
}

// connect to your database
sql.connect(config, async function (err) {
    if (err) console.log(err);
    calculateResults([],[]);
    return;
    // create Request object


    // let raw_material = await runQuery(`select *
    //     from recipe_0_raw_material_in raw_in
    //     join recipe_0_raw_material_used  raw_used ON raw_used.process_order_sap3 = raw_in.process_order_sap3 AND raw_used.id=raw_in.id
    //     ORDER BY `);
    let input = [];
    let label = [];
    let orders = await runQuery("SELECT * from recipe_0_orders_details WHERE data_split = 'training'");
    for (let order of orders.recordset) {
        let bigbag = await runQuery(`SELECT *, CAST(CONVERT(datetime,bigbag_filling_time_end) as float) as time FROM recipe_0_processing_details_bigbag WHERE orders_details_id = ${order.id} ORDER BY bigbag_filling_time_end`);
        let dd = await runQuery(`SELECT *, CAST(CONVERT(datetime,testing_time) as float) as time FROM recipe_0_processing_details_dd WHERE orders_details_id = ${order.id} ORDER BY testing_time`);
        let slurry = await runQuery(`SELECT *, CAST(CONVERT(datetime,slurry_start_time) as float) as time FROM recipe_0_processing_details_slurry WHERE orders_details_id = ${order.id} ORDER BY slurry_start_time`);
        let outSemi = await runQuery(`SELECT *, CAST(CONVERT(datetime,bigbag_filling_time_end) as float) as time FROM recipe_0_out_semi_finished_production WHERE orders_details_id = ${order.id} ORDER BY bigbag_filling_time_end`);
        let outTest = await runQuery(`SELECT *, CAST(CONVERT(datetime,testing_time) as float) as time FROM recipe_0_out_test_during_production WHERE orders_details_id = ${order.id} ORDER BY testing_time`);

        await fillWithData(order.id, bigbag, dd, slurry, outSemi, outTest, input, label);
    }
    let tensor = convertToTensor(input, label);
    let model = createModel();
    let trainResult = await trainModel(model, tensor.inputs, tensor.labels);
    console.log('Done Training');
    let ordersTest = await runQuery("SELECT * from recipe_0_orders_details WHERE data_split = 'test'");
    let inputTest = [];
    let labelTest = [];
    for (let order of ordersTest.recordset) {
        let bigbag = await runQuery(`SELECT *, CAST(CONVERT(datetime,bigbag_filling_time_end) as float) as time FROM recipe_0_processing_details_bigbag WHERE orders_details_id = ${order.id} ORDER BY bigbag_filling_time_end`);
        let dd = await runQuery(`SELECT *, CAST(CONVERT(datetime,testing_time) as float) as time FROM recipe_0_processing_details_dd WHERE orders_details_id = ${order.id} ORDER BY testing_time`);
        let slurry = await runQuery(`SELECT *, CAST(CONVERT(datetime,slurry_start_time) as float) as time FROM recipe_0_processing_details_slurry WHERE orders_details_id = ${order.id} ORDER BY slurry_start_time`);
        let outSemi = await runQuery(`SELECT *, CAST(CONVERT(datetime,bigbag_filling_time_end) as float) as time FROM recipe_0_out_semi_finished_production WHERE orders_details_id = ${order.id} ORDER BY bigbag_filling_time_end`);
        let outTest = await runQuery(`SELECT *, CAST(CONVERT(datetime,testing_time) as float) as time FROM recipe_0_out_test_during_production WHERE orders_details_id = ${order.id} ORDER BY testing_time`);

        await fillWithData(order.id, bigbag, dd, slurry, outSemi, outTest, inputTest, labelTest);
    }
    testModel(model, inputTest, labelTest, tensor);
    // console.log(tensor);
});


function findNearest(data, value) {
    let result = null;
    let distance = Number.POSITIVE_INFINITY;
    for (let x of data) {
        if (Math.abs(x.time - value) < distance) {
            distance = Math.abs(x.time - value);
            result = x;
        }
    }
    return result;
}

function runQuery(query) {
    return new Promise((resolve, reject) => {
        var request = new sql.Request();
        request.query(query, function (err, recordset) {
            if (err) reject(err);
            else resolve(recordset);
        });

    })
}

function convertToTensor(input, label) {
    // Wrapping these calculations in a tidy will dispose any
    // intermediate tensors.

    return tf.tidy(() => {
        // Step 1. Shuffle the data
        // tf.util.shuffle(data);

        // Step 2. Convert data to Tensor

        const inputTensor = tf.tensor2d(input, [input.length, input[0].length]);
        const labelTensor = tf.tensor2d(label, [label.length, label[0].length]);

        //Step 3. Normalize the data to the range 0 - 1 using min-max scaling
        const inputMax = inputTensor.max(0);
        const inputMin = inputTensor.min(0);
        const labelMax = labelTensor.max(0);
        const labelMin = labelTensor.min(0);

        const normalizedInputs = inputTensor.sub(inputMin).div(inputMax.sub(inputMin));
        const normalizedLabels = labelTensor.sub(labelMin).div(labelMax.sub(labelMin));

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

    model.add(tf.layers.dense({inputShape: [12], units: 12, useBias: true}));

    model.add(tf.layers.dense({units: 120, useBias: true}));
    model.add(tf.layers.dense({units: 50, useBias: true}));
    model.add(tf.layers.dense({units: 30, useBias: true}));

    model.add(tf.layers.dense({units: 3, useBias: true}));

    return model;
}

async function trainModel(model, inputs, labels) {
    // Prepare the model for training.
    model.compile({
        optimizer: tf.train.adam(0.00001),
        loss: tf.losses.meanSquaredError,
        metrics: ['mse'],
    });

    const batchSize = 128;
    const epochs = 10;

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
    const [preds] = tf.tidy(() => {

        const preds = model.predict(tf.tensor2d(inputs, [inputs.length, inputs[0].length]).sub(inputMin).div(inputMax.sub(inputMin)));
        const unNormPreds = preds
            .mul(labelMax.sub(labelMin))
            .add(labelMin);

        // Un-normalize the data
        return [unNormPreds.dataSync()];
    });
    console.log(labels[0], preds[0], preds[1], preds[2]);
    console.log(labels[200], preds[600], preds[601], preds[602]);
    console.log(labels[300], preds[900], preds[901], preds[902]);

    let reshapedInput = tf.tensor2d(labels, [labels.length, 3]).reshape([labels.length * 3]);
    let rootMeanSquaredError = Math.sqrt(tf.losses.meanSquaredError(reshapedInput, preds).dataSync()[0]);

    let reshapedInputArr = reshapedInput.dataSync();
    let predsArr = preds;
    var avgSum = [0, 0, 0];
    for (let i = 0; i < reshapedInputArr.length; i += 3) {
        avgSum[0] += reshapedInputArr[i]
        avgSum[1] += reshapedInputArr[i + 1]
        avgSum[2] += reshapedInputArr[i + 2]
    }
    let avg = [avgSum[0] / reshapedInputArr.length, avgSum[1] / reshapedInputArr.length, avgSum[2] / reshapedInputArr.length]
    let nominator = [0, 0, 0];
    let denominator = [0, 0, 0];
    for (let i = 0; i < predsArr.length/3; i++) {
        for (let j = 0; j < 3; j++) {
            nominator[j] += Math.pow(reshapedInputArr[i*3+j]- predsArr[i*3+j], 2)
            denominator[j] += Math.pow(reshapedInputArr[i*3+j] - avg[j], 2)
        }
    }
    let rSquared = [nominator[0] / denominator[0], nominator[1] / denominator[1], nominator[2] / denominator[2]]
    let rSquaredValue = (rSquared[0] + rSquared[1] + rSquared[2]) / 3
    let efciencyEnum = {below: 1, optimal: 2, above: 3}

    let efficiencyInput = [];
    let efficiencyPreds = [];
    for (let x of reshapedInputArr) {
        if (x[0] < 98)
            efficiencyInput.push(efciencyEnum.below)
        else if (x[0] <= 110)
            efficiencyInput.push(efciencyEnum.optimal)
        else
            efficiencyInput.push(efciencyEnum.above)
    }
    for (let x of predsArr) {
        if (x[0] < 98)
            efficiencyPreds.push(efciencyEnum.below)
        else if (x[0] <= 110)
            efficiencyPreds.push(efciencyEnum.optimal)
        else
            efficiencyPreds.push(efciencyEnum.above)
    }
    console.log(tf.tensor1d(efficiencyInput), tf.tensor1d(efficiencyPreds));
    let accuracy = tf.metrics.categoricalAccuracy(tf.tensor1d(efficiencyInput), tf.tensor1d(efficiencyPreds)).dataSync()[0];

    console.log({rootMeanSquaredError, rSquaredValue, accuracy});
}
function calculateResults(oryginal, preds){
    let spawn = require('child_process').spawn;
    let dataString='';
    let s=spawn('python', ['./count.py']);
    s.stdout.on('data', data=>{
        dataString+=data.toString();
    })
    s.stdout.on('end', ()=>{
        console.log(+dataString+2)
    })
    s.stdin.write(JSON.stringify({oryginal,preds}))

}