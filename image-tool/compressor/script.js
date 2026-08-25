let compressedBlob = null;

async function compressImage() {

    const file =
        document.getElementById("imageInput").files[0];

    if (!file) {
        alert("Select PNG image first");
        return;
    }

    const targetKB =
        parseInt(document.getElementById("targetSize").value);

    const img = new Image();

    img.onload = async function () {

        const canvas =
            document.createElement("canvas");

        const ctx =
            canvas.getContext("2d");

        canvas.width = img.width;
        canvas.height = img.height;

        ctx.drawImage(img,0,0);

        let scale = 1;
        let finalBlob = null;

        for(let i=0;i<15;i++){

            const w =
                Math.max(100,
                Math.floor(img.width*scale));

            const h =
                Math.max(100,
                Math.floor(img.height*scale));

            const tempCanvas =
                document.createElement("canvas");

            tempCanvas.width = w;
            tempCanvas.height = h;

            const tempCtx =
                tempCanvas.getContext("2d");

            tempCtx.drawImage(
                img,
                0,
                0,
                w,
                h
            );

            const blob =
                await new Promise(resolve =>
                    tempCanvas.toBlob(
                        resolve,
                        "image/png"
                    )
                );

            if(blob.size/1024 <= targetKB){
                finalBlob = blob;
                break;
            }

            finalBlob = blob;
            scale *= 0.90;
        }

        compressedBlob = finalBlob;

        const originalKB =
            (file.size/1024).toFixed(2);

        const compressedKB =
            (finalBlob.size/1024).toFixed(2);

        const reduction =
            (
                (
                    (file.size-finalBlob.size)
                    / file.size
                ) *100
            ).toFixed(1);

        document.getElementById("originalSize")
            .innerText = originalKB + " KB";

        document.getElementById("compressedSize")
            .innerText = compressedKB + " KB";

        document.getElementById("reduction")
            .innerText = reduction + "%";

        document.getElementById("preview")
            .src = URL.createObjectURL(finalBlob);

        document.getElementById("result")
            .style.display = "block";

        document.getElementById("downloadBtn")
            .onclick = function(){

                const a =
                    document.createElement("a");

                a.href =
                    URL.createObjectURL(finalBlob);

                a.download =
                    "compressed-image.png";

                a.click();
            };
    };

    img.src = URL.createObjectURL(file);
}