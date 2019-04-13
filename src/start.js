var sql = require("mssql");
const tf = require("@tensorflow/tfjs");

// config for your database
var config = {
    user: 'hack17',
    password: 'd6yBewvpT4!',
    server: '192.168.250.3',
    database: 'hackathon_danone'
};
function avg(array, key){
    let sum=0;
    for(let x of array){
        sum+=+x[key]
    }
    return sum/array.length;
}
async function fillWithData(orderId, input, label) {
    let dd = await runQuery(`SELECT *, testing_time as time FROM recipe_0_processing_details_dd WHERE orders_details_id = ${orderId} ORDER BY testing_time`);
    let slurry = await runQuery(`SELECT *, slurry_start_time as time FROM recipe_0_processing_details_slurry WHERE orders_details_id = ${orderId} ORDER BY slurry_start_time`);
    let outTest = await runQuery(`SELECT *, testing_time as time FROM recipe_0_out_test_during_production WHERE orders_details_id = ${orderId} ORDER BY testing_time`);
   // let outSemi = await runQuery(`SELECT *, bigbag_filling_time_end as time FROM recipe_0_out_semi_finished_production WHERE orders_details_id = ${orderId} ORDER BY testing_time`);

    let main = await runQuery(`SELECT finished.bigbag_filling_duration, finished.bigbag_filling_time_end, bigbag.sifter_speed_nominal_pct, semi.efficiency
                                from recipe_0_orders_details order_details
                                    JOIN recipe_0_processing_details_bigbag bigbag ON bigbag.orders_details_id = order_details.id
                                    join recipe_0_out_semi_finished_production semi ON semi.bigbag_number = bigbag.bigbag_number AND semi.orders_details_id = order_details.id
                                    JOIN recipe_0_out_semi_finished_production finished ON finished.orders_details_id=order_details.id AND finished.bigbag_number=bigbag.bigbag_number
                                 where id = ${orderId}
   `);

    for (let row of main.recordset) {
        let start=row.bigbag_filling_time_end - row.bigbag_filling_duration*60000;
        let end=row.bigbag_filling_time_end;
        row.dd = aggregateData(dd.recordset, start,end)
        row.slurry = aggregateData(slurry.recordset, start,end)
        row.outTest = aggregateData(outTest.recordset, start,end)
        let startString=new Date(start).toISOString()
        let endString=new Date(end).toISOString()

        row.walec=(await runQuery(`SELECT AVG(steam_pressure_at_the_inlet_of_regulation_unit) as a, avg(product_temperature_at_the_outlet_of_JetCooker) as b, avg(setpoint_of_steam_pressure_at_the_DD_inlet) as c, avg(condensate_temperature_at_DD_outlet) as d, avg(product_temperature_at_the_inlet) as e, avg(setpoint_of_product_temperature) as f, avg(product_temperature_at_the_outlet_of_JetCooker) as g, avg(steam_pressure_at_the_inlet_of_JetCooker) as h, avg(steam_pressure_at_the_outlet_of_regulation_unit) as i, avg(product_temperature_at_the_outlet_of_product) as j FROM [Walec DD08] as DD08 WHERE timestamp between convert(varchar, '${startString}', 120) AND convert(varchar, '${endString}', 120)`)).recordset[0]
        if (row.dd.length==0 || row.slurry.length==0 || row.outTest.length==0)
            continue;
        let inputArray = [
         row.walec.a, row.walec.b, row.walec.c, row.walec.d, row.walec.e, row.walec.f, row.walec.g, row.walec.h, row.walec.i, row.walec.j,
            row.sifter_speed_nominal_pct,
            avg(row.dd, 'steam_preasure'), avg(row.dd, 'dd_speed'), avg(row.dd, 'temp_out'),
            avg(row.slurry, 'water_pct'), avg(row.slurry, 'water_correction'),
        ];
        let outputArray = [row.efficiency, avg(row.outTest,'moisture'),  avg(row.outTest,'bulk_density')]
        input.push(inputArray);
        label.push(outputArray);
    }
}
function aggregateData(data, start,end){
    let founded=[];
    for(let item of data){
        if(item.time >=start && item.time <=end){
            founded.push(item);
        }
    }
    return founded;
}
// connect to your database
sql.connect(config, async function (err) {
    if (err) console.log(err);

    // create Request object


    // let raw_material = await runQuery(`select *
    //     from recipe_0_raw_material_in raw_in
    //     join recipe_0_raw_material_used  raw_used ON raw_used.process_order_sap3 = raw_in.process_order_sap3 AND raw_used.id=raw_in.id
    //     ORDER BY `);
    let input = [];
    let label = [];
    let orders = await runQuery("SELECT * from recipe_0_orders_details WHERE data_split = 'training'");
    for (let order of orders.recordset) {

        await fillWithData(order.id, input, label);
    }
    let tensor = convertToTensor(input, label);
    let model = createModel();
    let trainResult = await trainModel(model, tensor.inputs, tensor.labels);
    console.log('Done Training');
    let ordersTest = await runQuery("SELECT * from recipe_0_orders_details WHERE data_split = 'test'");
    let inputTest = [];
    let labelTest = [];
    for (let order of ordersTest.recordset) {
               await fillWithData(order.id, inputTest, labelTest);
    }
    testModel(model, inputTest, labelTest, tensor);
    // console.log(tensor);
});


function findNearest(data, value) {
    let result = null;
    let distance = Number.POSITIVE_INFINITY;
    for (let x of data) {
        if ((x.time - value) < distance) {
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
function avoidZeros(min,max){
    const minArray=min.dataSync();
    const maxArray=max.dataSync();
    for(let i=0;i<minArray.length;i++){
        if(minArray[i]==maxArray[i]){
            minArray[i]-=1;
            maxArray[i]+=1;
        }
    }
    return [tf.tensor(minArray ),tf.tensor(maxArray)]
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
      const [inputMinSafe, inputMaxSafe]=  avoidZeros(inputMin, inputMax);
        const labelMax = labelTensor.max(0);
        const labelMin = labelTensor.min(0);
        const [labelMinSafe, labelMaxSafe]=  avoidZeros(labelMax, labelMin);

        const normalizedInputs = inputTensor.sub(inputMinSafe).div(inputMaxSafe.sub(inputMinSafe));
        const normalizedLabels = labelTensor.sub(labelMinSafe).div(labelMaxSafe.sub(labelMinSafe));

        return {
            inputs: inputTensor,
            labels: labelTensor,
            // Return the min/max bounds so we can use them later.
            inputMax:inputMaxSafe,
            inputMin:inputMinSafe,
            labelMax:labelMaxSafe,
            labelMin:labelMinSafe,
        }
    });
}

function createModel() {
    // Create a sequential model
    const model = tf.sequential();

    model.add(tf.layers.dense({inputShape: [16], units: 16, useBias: true}));

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

        const predsTensor = model.predict(tf.tensor2d(inputs, [inputs.length, inputs[0].length]).sub(inputMin).div(inputMax.sub(inputMin)));
        console.log(predsTensor.dataSync())
        const unNormPreds = predsTensor
            .mul(labelMax.sub(labelMin))
            .add(labelMin);

        // Un-normalize the data
        return [unNormPreds.reshape([inputs.length, 3]).dataSync()];
    });

    console.log(labels, preds)


}