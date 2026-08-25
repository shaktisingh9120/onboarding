/*********************************************
 * REMOVE.BG API KEY
 *********************************************/
const API_KEY = "4VkSaEAWxmXb8cZCju8pM68w";

/*********************************************
 * ELEMENTS
 *********************************************/
const imageInput = document.getElementById("imageInput");
const originalPreview = document.getElementById("originalPreview");
const resultPreview = document.getElementById("resultPreview");
const downloadBtn = document.getElementById("downloadBtn");

let selectedFile = null;

/*********************************************
 * FILE UPLOAD
 *********************************************/
imageInput.addEventListener("change", (e) => {

  selectedFile = e.target.files[0];

  if (!selectedFile) return;

  originalPreview.src = URL.createObjectURL(selectedFile);

  resultPreview.src = "";
  downloadBtn.style.display = "none";
});

/*********************************************
 * REMOVE BACKGROUND
 *********************************************/
async function removeBackground() {

  if (!selectedFile) {
    alert("Please upload an image first.");
    return;
  }

  try {

    const formData = new FormData();

    formData.append(
      "image_file",
      selectedFile
    );

    const response = await fetch(
      "https://api.remove.bg/v1.0/removebg",
      {
        method: "POST",
        headers: {
          "X-Api-Key": API_KEY
        },
        body: formData
      }
    );

    if (!response.ok) {

      const errorText =
        await response.text();

      console.error(errorText);

      throw new Error(
        "Background removal failed."
      );
    }

    const blob =
      await response.blob();

    const imageUrl =
      URL.createObjectURL(blob);

    resultPreview.src = imageUrl;

    downloadBtn.style.display =
      "inline-block";

    downloadBtn.onclick = () => {

      const a =
        document.createElement("a");

      a.href = imageUrl;

      a.download =
        "background-removed.png";

      document.body.appendChild(a);

      a.click();

      document.body.removeChild(a);
    };

  } catch (error) {

    console.error(error);

    alert(
      "Error removing background. Check API key or internet connection."
    );
  }
}