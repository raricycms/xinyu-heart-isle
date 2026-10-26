import { ButtonLink } from '@/components/ui/Button';
import '@/styles/home.css';

export default function NotFoundPage() {
  return (
    <div className="page">
      <div className="notfound">
        <div className="notfound__code mono">404</div>
        <h1 className="page-title">这个页面不存在</h1>
        <p className="page-subtitle">
          可能是链接过期了，也可能是打错了一个字。没关系，从这里重新开始就好。
        </p>
        <div className="btn-group mt-4">
          <ButtonLink to="/">回到首页</ButtonLink>
          <ButtonLink to="/toolbox" variant="ghost">
            我现在有点难受
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}
