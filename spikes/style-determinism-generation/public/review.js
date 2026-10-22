const forms = document.querySelectorAll("form.judgement");

for (const form of forms) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(form));
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      const response = await fetch("/api/judgements", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error("save failed");
      window.location.reload();
    } catch {
      button.disabled = false;
      form.submit();
    }
  });
}
