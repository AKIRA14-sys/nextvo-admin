import type { MetadataRoute } from "next";

type ShareTargetManifest = MetadataRoute.Manifest & {
  share_target: {
    action: string;
    method: "POST";
    enctype: "application/x-www-form-urlencoded";
    params: { title: string; text: string; url: string };
  };
};

export default function manifest(): ShareTargetManifest {
  return {
    id: "/",
    name: "NEXTVO Admin",
    short_name: "NEXTVO Admin",
    description: "Private NEXTVO business management app",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    background_color: "#080b12",
    theme_color: "#080b12",
    orientation: "portrait-primary",
    share_target: {
      action: "/api/share/receive",
      method: "POST",
      enctype: "application/x-www-form-urlencoded",
      params: { title: "title", text: "text", url: "url" },
    },
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
    ]
  };
}
