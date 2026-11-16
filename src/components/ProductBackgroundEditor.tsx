"use client";

import { useRef, type ChangeEvent } from "react";
import { Check, ImagePlus, Trash2 } from "lucide-react";
import { MAX_PRODUCT_BACKGROUND_OPTIONS, type ProductBackgroundOption } from "@/lib/product-backgrounds";

type ProductBackgroundEditorProps = {
  photoUrl: string;
  photoAlt: string;
  backgrounds: ProductBackgroundOption[];
  selectedBackgroundId?: string;
  disabled?: boolean;
  onAdd: (file: File) => void;
  onSelect: (id?: string) => void;
  onRemove: (id: string) => void;
};

export function ProductBackgroundEditor({
  photoUrl,
  photoAlt,
  backgrounds,
  selectedBackgroundId,
  disabled = false,
  onAdd,
  onSelect,
  onRemove,
}: ProductBackgroundEditorProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const selected = backgrounds.find((background) => background.id === selectedBackgroundId);
  const previewStyle = selected
    ? { backgroundImage: `url("${selected.cardUrl || selected.url}")` }
    : undefined;

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file) onAdd(file);
  }

  return (
    <section className="product-background-editor" aria-label={`Background options for ${photoAlt || "product image"}`}>
      <div className="background-editor-heading">
        <div>
          <h3>Background for this image</h3>
          <p>Choose one of your own images, or keep the original background.</p>
        </div>
        <span className="tag">{backgrounds.length}/{MAX_PRODUCT_BACKGROUND_OPTIONS}</span>
      </div>

      <div className="background-product-preview" style={previewStyle}>
        <img src={photoUrl} alt={`Full photo preview for ${photoAlt || "product"}`} />
        <span>{selected ? "Selected background · full photo fit" : "Original background"}</span>
      </div>

      <p className="helper background-editor-note">
        Product image pixels are not erased or detected. Your backdrop shows through transparent areas; use a transparent product cut-out for a full background change. The original photo is kept.
      </p>

      <div className="background-choice-list" aria-label="Choose a background">
        <button
          type="button"
          className={`background-choice${selected ? "" : " selected"}`}
          aria-pressed={!selected}
          onClick={() => onSelect(undefined)}
          disabled={disabled}
        >
          <span className="background-choice-preview original-background-choice">
            <img src={photoUrl} alt="" />
          </span>
          <span className="background-choice-label">Original</span>
          {!selected && <Check size={14} aria-hidden="true" />}
        </button>

        {backgrounds.map((background, index) => {
          const isSelected = background.id === selectedBackgroundId;
          return (
            <div className={`background-option${isSelected ? " selected" : ""}`} key={background.id}>
              <button
                type="button"
                className="background-choice"
                aria-pressed={isSelected}
                onClick={() => onSelect(background.id)}
                disabled={disabled}
              >
                <span className="background-choice-preview">
                  <img src={background.cardUrl || background.url} alt="" />
                </span>
                <span className="background-choice-label">Background {index + 1}</span>
                {isSelected && <Check size={14} aria-hidden="true" />}
              </button>
              <button
                type="button"
                className="background-remove"
                aria-label={`Remove background ${index + 1}`}
                title={`Remove background ${index + 1}`}
                onClick={() => onRemove(background.id)}
                disabled={disabled}
              >
                <Trash2 size={13} />
              </button>
            </div>
          );
        })}
      </div>

      {backgrounds.length < MAX_PRODUCT_BACKGROUND_OPTIONS && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            onChange={chooseFile}
            disabled={disabled}
            hidden
          />
          <button
            type="button"
            className="button small background-add-button"
            onClick={() => inputRef.current?.click()}
            disabled={disabled}
          >
            <ImagePlus size={14} /> Add your background ({backgrounds.length}/{MAX_PRODUCT_BACKGROUND_OPTIONS})
          </button>
        </>
      )}
    </section>
  );
}
