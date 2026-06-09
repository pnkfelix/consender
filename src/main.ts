import { createRoot } from "./model.js";
import { mount } from "./view.js";

const app = document.getElementById("app")!;
mount(app, createRoot());
