import './landing.css'

// 랜딩 (design/mockups/landing.html 을 옮김). 진단은 /start/ — 일반 링크로 열어 진단 화면 스타일만 따로 불러옴
const Icon = ({ id }: { id: string }) => <svg className="icon" aria-hidden="true"><use href={'/icons/icons.svg#' + id} /></svg>
const StepIcon = ({ id }: { id: string }) => <span className="step-ic" aria-hidden="true"><Icon id={id} /></span>

export default function Landing() {
  return (
    <>
      <header className="top">
        <div className="wrap">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <a className="brand" href="/"><img src="/icons/favicon.svg" alt="" width={26} height={26} />공부길</a>
        </div>
      </header>
      <main>
        <section className="hero" aria-labelledby="hero-title">
          <div className="wrap m-enter">
            <h1 id="hero-title">어디부터 공부할지,<br />약한 곳부터 같이 찾아요</h1>
            <p className="lead">성적과 약하다고 느끼는 단원을 체크하면, 수준에 맞는 강의와 책을 찾아 드려요.</p>
            <a className="cta m-press" href="/start/#/info">진단 시작하기</a>
            <ul className="subjects" aria-label="진단할 수 있는 과목">
              {[['korean', '국어'], ['english', '영어'], ['math', '수학']].map(([id, label]) => (
                <li key={id}><span className={'subj-icon ' + id} aria-hidden="true"><Icon id={'i-' + id} /></span>{label}</li>
              ))}
            </ul>
            <ul className="facts">
              <li><Icon id="i-time" />5~10분 걸려요</li>
              <li><Icon id="i-privacy" />이름이나 학교는 묻지 않아요</li>
              <li>중1~고3, 2015·2022 개정 교육과정</li>
            </ul>
          </div>
        </section>

        <section className="block" aria-labelledby="how-title">
          <div className="wrap">
            <h2 id="how-title">이렇게 진행돼요</h2>
            <ol className="steps">
              <li><StepIcon id="i-score" /><h3>성적 적기</h3><p>최근 시험 점수나 등급을 적어요. 아는 것만 적어도 돼요.</p></li>
              <li><StepIcon id="i-check-area" /><h3>약한 곳 표시하기</h3><p>단원마다 자신 있음, 보통, 약함 중 하나를 골라요.</p></li>
              <li><StepIcon id="i-recommend" /><h3>추천 받기</h3><p>약하거나 보통인 곳마다 수준에 맞는 영상 강의와 책을 찾아 드려요.</p></li>
            </ol>
          </div>
        </section>

        <section className="block" aria-labelledby="get-title">
          <div className="wrap">
            <h2 id="get-title">결과로 받는 것</h2>
            <div className="gets">
              <div><StepIcon id="i-diagnosis" /><h3>과목별 수준</h3><p>상, 중, 하로 알려 주고, 왜 그렇게 봤는지도 보여 줘요.</p></div>
              <div><StepIcon id="i-check-area" /><h3>먼저 볼 영역</h3><p>약한 영역부터 순서대로 정리해 줘요.</p></div>
              <div><StepIcon id="i-lecture" /><h3>영상 강의와 책</h3><p>사람이 확인하고 승인한 무료 강의와 교재(EBS·시중 자습서·개념서)를 영역마다 보여 줘요.</p></div>
            </div>
            <div className="privacy">
              <h3>개인정보 안내</h3>
              <p>이름이나 학교는 묻지 않아요. 입력한 성적은 이 화면 안에서만 계산하고 어디에도 저장하거나 보내지 않아요. 추천은 미리 확인해 둔 목록에서 골라요. 강의 썸네일과 책 표지는 YouTube·카카오에서 바로 불러오는데, 이때 어느 화면에서 왔는지는 보내지 않아요. 추천에는 제휴·광고 링크를 넣지 않아요.</p>
            </div>
          </div>
        </section>

        <footer className="foot">
          <div className="wrap">
            <p>수준을 나누는 기준은 아직 임시 기준이에요. 결과는 내가 직접 체크한 내용을 바탕으로 해요.</p>
            <p>콘텐츠 라이선스: CC BY-NC-SA 4.0</p>
            <p>문의: 〈연락처〉</p>
          </div>
        </footer>
      </main>
    </>
  )
}
