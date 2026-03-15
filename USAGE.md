# Video Stitcher User Guide

Welcome to **Video Stitcher**, a simple and efficient tool designed to combine your favorite videos and images into a single, seamless masterpiece. Whether you are creating a montage or a quick presentation, this guide will help you get started.

---

## 1. Set Your Image Duration

Before you upload your files, you may want to adjust the image display duration.

* **How it works:** Any images you upload (JPG, PNG, etc.) are automatically converted into video clips.
* **Default Duration:** The standard duration is **1 second**, set via the "Default Image Duration (seconds)" field. This applies to all images that don't have a custom duration.
* **Per-Image Duration:** After adding images to the list, you can set an individual duration for each image directly in the file row. Leave it blank to use the default.

## 2. Adding Your Media

You can add both video and image files using two convenient methods:

* **Drag & Drop:** Simply drag your files from your computer and drop them directly into the white dashed box labeled "Drag & Drop video or image files here."
* **Manual Selection:** Click anywhere inside the dashed box to open your local file browser and select your files manually.

## 3. Background Audio (Optional)

You can overlay a background audio track on the final video.

* **Add audio:** Click **Choose or drop background audio (optional)** below the drop zone, or drag an audio file (MP3, AAC, WAV, FLAC, etc.) directly onto that area.
* **Volume:** Use the **Volume** slider to set playback level from **0.0** (muted) to **2.0** (double the original). **1.0** plays the audio at its original volume.
* **Looping:** The audio track is automatically looped to match the full length of the stitched video — no need to trim it beforehand.
* **Remove:** Click the **×** button next to the filename to clear the selected audio.

> **Note:** If you add only a single video with no background audio, the Stitch button is disabled — there is nothing to process in that case.

---

## 4. Organizing Your Clips

Once your files appear in the **Selected Files** list, the order in which they appear is the order in which they will play.

* **Reorder:** Use the **Up ($\uparrow$)** and **Down ($\downarrow$)** arrow icons on the right side of each file row to move a clip. The file at the top will be the first clip in your final video.
* **Remove:** If you change your mind about a file, click the **Red X** icon to remove it from the list.

---

## 5. Stitching the Videos

When you are satisfied with the order of your clips, click the large blue **Stitch Videos** button at the bottom.

1. **Uploading:** The app will begin uploading your files to the cloud for processing.
2. **Processing:** Your clips will be concatenated (joined together) into a single file.
3. **Progress Bar:** You can track the status via the progress bar. Wait until it reaches **100%**.

## 6. Preview and Download

Once the stitching process is complete:

* **Preview:** The final video will be embedded directly on the webpage for you to watch.
* **Download:** Click the **Download Stitched Video** button below the player to save the MP4 to your device.

> **Note:** The output file is kept on the server for a short time (default: 5 minutes) before being automatically deleted. Download your video promptly after stitching.

---

## Tips for Best Results

To ensure your final video looks polished and professional, keep these technical tips in mind:

* **Uniform Resolution:** For the best visual quality, ensure all your source files are the same size (e.g., all 1080p or all 720p). 
* **Aspect Ratio Consistency:** Stick to one orientation. Combining 16:9 (Landscape) with 9:16 (Portrait) files may result in black bars or unexpected cropping.
* **Pre-Crop Images:** If you have photos that don't match your video's aspect ratio, crop them in a photo editor before uploading to prevent them from looking stretched.

---

## Frequently Asked Questions (FAQ)

**Do my files need to be the same size?**
Yes. To ensure a smooth transition and a professional-looking output, **all images and videos must be in the same aspect ratio and resolution (size).** Mixing different sizes (e.g., a vertical phone video with a horizontal landscape photo) may cause errors or visual distortion in the final file.

**Can I change the duration of just one image?**
Yes. After adding images to the list, each image row shows a duration field you can edit individually. Leave it blank to fall back to the default duration.

**What happens if I close the tab during the progress bar?**
If you close the tab before the process reaches 100%, the stitching will be interrupted, and you will need to start the upload and stitching process over again.

**How many files can I stitch at once?**
Up to 50 media files can be added in a single job. Larger files and higher quantities will take longer to upload and process depending on your internet connection.

**Can I use a background audio track longer or shorter than the video?**
Yes. The audio is looped if it is shorter than the video, and trimmed automatically if it is longer — the final output always matches the total video duration.