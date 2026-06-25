function createViewer(photos) {
  const viewer = document.createElement("div");
  const image = document.createElement("img");
  const previousButton = document.createElement("button");
  const nextButton = document.createElement("button");
  const closeButton = document.createElement("button");
  let currentIndex = 0;

  viewer.className = "photo-viewer";
  viewer.hidden = true;
  viewer.setAttribute("role", "dialog");
  viewer.setAttribute("aria-modal", "true");
  viewer.setAttribute("aria-label", "Photo viewer");

  image.className = "photo-viewer-image";
  image.alt = "";

  previousButton.className = "photo-viewer-control photo-viewer-previous";
  previousButton.type = "button";
  previousButton.textContent = "Previous";
  previousButton.setAttribute("aria-label", "Previous photo");

  nextButton.className = "photo-viewer-control photo-viewer-next";
  nextButton.type = "button";
  nextButton.textContent = "Next";
  nextButton.setAttribute("aria-label", "Next photo");

  closeButton.className = "photo-viewer-close";
  closeButton.type = "button";
  closeButton.textContent = "Close";
  closeButton.setAttribute("aria-label", "Close photo viewer");

  function updateViewer() {
    const photo = photos[currentIndex];

    image.src = photo.src;
    image.alt = photo.alt || "";
    previousButton.disabled = photos.length < 2;
    nextButton.disabled = photos.length < 2;
  }

  function openViewer(index) {
    currentIndex = index;
    updateViewer();
    viewer.hidden = false;
    document.body.classList.add("viewer-open");
    closeButton.focus();
  }

  function closeViewer() {
    viewer.hidden = true;
    document.body.classList.remove("viewer-open");
  }

  function showPrevious() {
    currentIndex = (currentIndex - 1 + photos.length) % photos.length;
    updateViewer();
  }

  function showNext() {
    currentIndex = (currentIndex + 1) % photos.length;
    updateViewer();
  }

  previousButton.addEventListener("click", showPrevious);
  nextButton.addEventListener("click", showNext);
  closeButton.addEventListener("click", closeViewer);
  viewer.addEventListener("click", (event) => {
    if (event.target === viewer) {
      closeViewer();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (viewer.hidden) {
      return;
    }

    if (event.key === "Escape") {
      closeViewer();
    }

    if (event.key === "ArrowLeft") {
      showPrevious();
    }

    if (event.key === "ArrowRight") {
      showNext();
    }
  });

  viewer.append(closeButton, previousButton, image, nextButton);
  document.body.append(viewer);

  return openViewer;
}

async function loadPhotos() {
  const grid = document.querySelector("[data-photo-grid]");
  const emptyState = document.querySelector("[data-empty-state]");

  if (!grid || !emptyState) {
    return;
  }

  try {
    const response = await fetch("data/photos.json", { cache: "no-store" });

    if (!response.ok) {
      throw new Error(`Unable to load photos: ${response.status}`);
    }

    const photos = await response.json();

    if (!Array.isArray(photos) || photos.length === 0) {
      return;
    }

    const fragment = document.createDocumentFragment();
    const openViewer = createViewer(photos);

    photos.forEach((photo, index) => {
      if (!photo || !photo.src) {
        return;
      }

      const figure = document.createElement("figure");
      const button = document.createElement("button");
      const image = document.createElement("img");

      figure.className = "photo-item";
      button.className = "photo-button";
      button.type = "button";
      button.setAttribute("aria-label", `Open photo ${index + 1}`);
      image.src = photo.thumb || photo.src;
      image.alt = photo.alt || "";
      image.loading = index < 15 ? "eager" : "lazy";
      image.decoding = "async";

      button.addEventListener("click", () => openViewer(index));
      button.append(image);
      figure.append(button);
      fragment.append(figure);
    });

    if (!fragment.childElementCount) {
      return;
    }

    grid.append(fragment);
    grid.hidden = false;
    emptyState.hidden = true;
  } catch (error) {
    console.warn(error.message);
  }
}

loadPhotos();
