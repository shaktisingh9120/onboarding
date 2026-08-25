let currentImage = null;
let convertedBlob = null;
let fileName = "image";

const input = document.getElementById("imageInput");
const preview = document.getElementById("previewImage");

input.addEventListener("change", function(){

    const file = this.files[0];

    if(!file) return;

    fileName = file.name.split(".")[0];

    const reader = new FileReader();

    reader.onload = function(e){

        currentImage = new Image();

        currentImage.onload = function(){
            preview.src = e.target.result;
        }

        currentImage.src = e.target.result;
    }

    reader.readAsDataURL(file);

});

function convertToPNG(){

    if(!currentImage){
        alert("Upload image first");
        return;
    }

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    canvas.width = currentImage.width;
    canvas.height = currentImage.height;

    ctx.drawImage(currentImage,0,0);

    canvas.toBlob(blob=>{

        convertedBlob = blob;

        preview.src = URL.createObjectURL(blob);

        alert("Converted to PNG");

    },"image/png");
}

function convertToJPG(){

    if(!currentImage){
        alert("Upload image first");
        return;
    }

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    canvas.width = currentImage.width;
    canvas.height = currentImage.height;

    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0,0,canvas.width,canvas.height);

    ctx.drawImage(currentImage,0,0);

    canvas.toBlob(blob=>{

        convertedBlob = blob;

        preview.src = URL.createObjectURL(blob);

        alert("Converted to JPG");

    },"image/jpeg",0.95);
}

function downloadImage(){

    if(!convertedBlob){
        alert("Convert image first");
        return;
    }

    const a = document.createElement("a");

    a.href = URL.createObjectURL(convertedBlob);

    if(convertedBlob.type==="image/png"){
        a.download = fileName + ".png";
    }
    else{
        a.download = fileName + ".jpg";
    }

    a.click();
}