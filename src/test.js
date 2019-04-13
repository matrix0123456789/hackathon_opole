function calculateResults(oryginal, preds){
    let spawn = require('child_process').spawn;
    let dataString='';
    let s=spawn('python', ['./count.py']);
    s.stdout.on('data', data=>{
        dataString+=data.toString();
    })
    s.stdout.on('end', ()=>{
        console.log(dataString)
    })
    s.stdin.write(JSON.stringify({oryginal,preds}))

}
calculateResults(1,2)