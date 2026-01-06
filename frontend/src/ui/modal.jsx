export function Modal({ title, children, onClose, footer }){
  return (
    <div className="modalBackdrop" onMouseDown={(e)=>{ if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="modal" role="dialog" aria-modal="true">
        <div className="modalHeader">
          <div className="modalTitle">{title}</div>
          <div id="googleBtnMount" />
          <button className="btn" onClick={onClose}>Close</button>
        </div>
        <div className="modalBody">{children}</div>
        {footer ? <div className="modalFooter">{footer}</div> : null}
      </div>
    </div>
  );
}
