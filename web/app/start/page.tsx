import '../screen.css'
import Diagnosis from '../Diagnosis'

// 진단 1~5단계 (#/info → #/grades → #/areas → #/result → #/recommend). 진단 화면 스타일은 여기서만 불러옴
export default function Start() {
  return <Diagnosis />
}
