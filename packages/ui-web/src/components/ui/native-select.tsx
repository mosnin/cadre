"use client";
import {
  Children,
  type ComponentProps,
  isValidElement,
  type ReactNode,
  useRef,
  useState,
} from "react";
import { Select, SelectContent, SelectItem, SelectTrigger } from "../../directory/select";
import { cn } from "../../lib/utils";

type NativeSelectProps = Omit<ComponentProps<"select">, "size"> & { size?: "sm" | "default" };
function optionNodes(
  children: ReactNode,
): { value: string; label: ReactNode; disabled?: boolean }[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement<{ value?: string; children?: ReactNode; disabled?: boolean }>(child))
      return [];
    if (child.type === NativeSelectOptGroup || child.type === "optgroup")
      return optionNodes(child.props.children).map((option) => ({
        ...option,
        disabled: child.props.disabled || option.disabled,
      }));
    return [
      {
        value: String(child.props.value ?? child.props.children ?? ""),
        label: child.props.children,
        disabled: child.props.disabled,
      },
    ];
  });
}
/** Directory selection UI with a hidden native form control preserving change events and submission. */
function NativeSelect({
  className,
  size,
  children,
  value,
  defaultValue,
  id,
  disabled,
  onChange,
  ref,
  ...props
}: NativeSelectProps) {
  const options = optionNodes(children);
  const [internal, setInternal] = useState(String(defaultValue ?? options[0]?.value ?? ""));
  const current = value === undefined ? internal : String(value);
  const nativeRef = useRef<HTMLSelectElement>(null);
  return (
    <Select
      id={id}
      value={current}
      disabled={disabled}
      className={cn("w-full min-w-0", className)}
      onValueChange={(next) => {
        if (value === undefined) setInternal(next);
        const native = nativeRef.current;
        if (native) {
          native.value = next;
          native.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }}
    >
      <select
        {...props}
        ref={(node) => {
          nativeRef.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) ref.current = node;
        }}
        hidden
        aria-hidden="true"
        aria-label={undefined}
        aria-labelledby={undefined}
        tabIndex={-1}
        value={current}
        disabled={disabled}
        onChange={onChange}
      >
        {children}
      </select>
      <SelectTrigger
        role="combobox"
        ariaLabel={props["aria-label"]}
        ariaDescribedBy={props["aria-describedby"]}
        ariaInvalid={props["aria-invalid"] === "true" || props["aria-invalid"] === true}
      >
        <span className="truncate">
          {options.find((option) => option.value === current)?.label ?? ""}
        </span>
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
function NativeSelectOption(props: ComponentProps<"option">) {
  return <option {...props} />;
}
function NativeSelectOptGroup(props: ComponentProps<"optgroup">) {
  return <optgroup {...props} />;
}

export { NativeSelect, NativeSelectOptGroup, NativeSelectOption };
