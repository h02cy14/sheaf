import type { ReactNode } from "react";
import { Button, Dialog as RacDialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { useTranslation } from "react-i18next";
import { Icon } from "./Icon";
import styles from "./Dialog.module.css";

/**
 * A modal panel. React Aria handles the focus trap, Escape, the scroll lock
 * and the `aria-modal` plumbing; the look is ours.
 */
export function Dialog({
  title,
  onClose,
  children,
  footer,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <ModalOverlay
      className={styles.overlay ?? ""}
      isOpen
      isDismissable
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Modal className={wide ? `${styles.modal} ${styles.wide}` : (styles.modal ?? "")}>
        <RacDialog className={styles.dialog ?? ""}>
          <div className={styles.header}>
            <Heading slot="title" className={styles.title ?? ""}>
              {title}
            </Heading>
            <Button className={styles.close ?? ""} onPress={onClose} aria-label={t("common.close")}>
              <Icon name="close" size={16} />
            </Button>
          </div>
          <div className={styles.content}>{children}</div>
          {footer !== undefined && <div className={styles.footer}>{footer}</div>}
        </RacDialog>
      </Modal>
    </ModalOverlay>
  );
}
